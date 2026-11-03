package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// EventPublisher abstracts RabbitMQ so handlers never fail on broker errors.
type EventPublisher interface {
	Publish(eventType string, o Order, correlationID string)
}

type NoopPublisher struct{}

func (NoopPublisher) Publish(eventType string, o Order, correlationID string) {
	log.Printf("event (noop) %s order=%s status=%s", eventType, o.ID, o.Status)
}

type RabbitPublisher struct {
	URL string
	mu  sync.Mutex
	ch  *amqp.Channel
}

func NewRabbitPublisher(url string) EventPublisher {
	if url == "" {
		return NoopPublisher{}
	}
	return &RabbitPublisher{URL: url}
}

func (p *RabbitPublisher) channel() (*amqp.Channel, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ch != nil && !p.ch.IsClosed() {
		return p.ch, nil
	}
	conn, err := amqp.Dial(p.URL)
	if err != nil {
		return nil, err
	}
	ch, err := conn.Channel()
	if err != nil {
		return nil, err
	}
	if err := ch.ExchangeDeclare("nexus.events", "topic", true, false, false, false, nil); err != nil {
		return nil, err
	}
	p.ch = ch
	return ch, nil
}

// Publish never returns an error to callers: failures are logged only.
func (p *RabbitPublisher) Publish(eventType string, o Order, correlationID string) {
	if correlationID == "" {
		correlationID = o.ID
	}
	envelope := map[string]interface{}{
		"eventId":       newID(),
		"eventType":     eventType,
		"occurredAt":    time.Now().UTC().Format(time.RFC3339),
		"aggregateId":   o.ID,
		"correlationId": correlationID,
		"eventVersion":  1,
		"payload": map[string]interface{}{
			"orderId":     o.ID,
			"userId":      o.UserID,
			"status":      o.Status,
			"totalAmount": o.TotalAmount,
		},
	}
	body, _ := json.Marshal(envelope)
	ch, err := p.channel()
	if err != nil {
		log.Printf("rabbitmq unavailable, dropping event %s: %v", eventType, err)
		return
	}
	err = ch.Publish("nexus.events", eventType, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
		Timestamp:    time.Now().UTC(),
	})
	if err != nil {
		log.Printf("rabbitmq publish %s failed: %v", eventType, err)
		p.mu.Lock()
		p.ch = nil
		p.mu.Unlock()
	}
}
