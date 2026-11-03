import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import Base, SessionLocal, engine, get_db
from .models import Notification, ProcessedEvent

logger = logging.getLogger(__name__)


def _err(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def consume_message(envelope: dict, db: Session):
    """Insert a notification for an event envelope once. Returns Notification or None if duplicate."""
    if not isinstance(envelope, dict):
        return None
    payload = envelope.get("payload") if isinstance(envelope.get("payload"), dict) else {}
    event_id = (envelope.get("eventId") or envelope.get("event_id")
                or envelope.get("id") or payload.get("eventId"))
    event_type = (envelope.get("eventType") or envelope.get("event_type")
                  or envelope.get("type") or "UNKNOWN")
    aggregate_id = (envelope.get("aggregateId") or envelope.get("aggregate_id")
                    or payload.get("orderId") or payload.get("aggregateId"))
    user_id = (payload.get("userId") or payload.get("user_id")
               or envelope.get("userId") or envelope.get("user_id"))
    if event_id and db.get(ProcessedEvent, str(event_id)):
        return None
    message = envelope.get("message") or (
        f"{event_type} for order {aggregate_id}" if aggregate_id else str(event_type))
    notification = Notification(
        user_id=str(user_id) if user_id else None,
        event_type=str(event_type), channel="LOG", message=str(message), status="SENT")
    db.add(notification)
    if event_id:
        db.add(ProcessedEvent(event_id=str(event_id)))
    else:
        event_id = uuid.uuid4().hex
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    db.refresh(notification)
    logger.info("notification: %s", message)
    return notification


async def _consume_forever() -> None:
    url = os.getenv("RABBITMQ_URL")
    if not url:
        logger.warning("RABBITMQ_URL unset; notification consumer not started")
        return
    while True:
        try:
            import aio_pika
            connection = await aio_pika.connect_robust(url)
            async with connection:
                channel = await connection.channel()
                exchange = await channel.declare_exchange(
                    "nexus.events", aio_pika.ExchangeType.TOPIC, durable=True)
                queue = await channel.declare_queue("notification.events", durable=True)
                await queue.bind(exchange, routing_key="#")

                async def on_message(message) -> None:
                    async with message.process():
                        try:
                            envelope = json.loads(message.body.decode())
                        except Exception:
                            logger.warning("dropping non-JSON message")
                            return
                        db = SessionLocal()
                        try:
                            consume_message(envelope, db)
                        finally:
                            db.close()

                await queue.consume(on_message)
                await asyncio.Future()  # run until cancelled/connection lost
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # unreachable RabbitMQ etc.: keep HTTP serving
            logger.warning("RabbitMQ consumer unavailable (%s); retrying in 5s", exc)
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    task = asyncio.create_task(_consume_forever())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Nexus Notification Service", version="0.1.0", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content=_err("HTTP_ERROR", str(exc.detail)))


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content=_err("VALIDATION_ERROR", str(exc.errors())))


def require_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not auth[7:].strip():
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Missing bearer token"))
    try:
        payload = jwt.decode(auth[7:].strip(), os.getenv("JWT_SECRET", ""), algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Invalid or expired token"))
    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Token missing sub"))
    return payload


class NotificationOut(BaseModel):
    id: str
    userId: str | None = None
    eventType: str
    channel: str
    message: str
    status: str
    createdAt: datetime | None = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "notification"}


@app.get("/notifications", response_model=list[NotificationOut])
def list_notifications(limit: int = Query(default=50, ge=1, le=200),
                       db: Session = Depends(get_db), user: dict = Depends(require_user)):
    stmt = select(Notification).order_by(Notification.created_at.desc())
    role = user.get("role")
    roles = user.get("roles") or ([role] if role else [])
    if "ADMIN" not in roles:
        stmt = stmt.where(Notification.user_id == str(user["sub"]))
    rows = db.scalars(stmt.limit(limit)).all()
    return [NotificationOut(id=n.id, userId=n.user_id, eventType=n.event_type,
                             channel=n.channel, message=n.message, status=n.status,
                             createdAt=n.created_at) for n in rows]
