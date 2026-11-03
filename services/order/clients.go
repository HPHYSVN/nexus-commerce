package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var ErrInsufficientStock = errors.New("insufficient stock")

type HTTPInventoryClient struct {
	BaseURL       string
	InternalToken string
	Client        *http.Client
}

type HTTPPaymentClient struct {
	BaseURL       string
	InternalToken string
	Client        *http.Client
}

func firstToken(tokens []string) string {
	if len(tokens) > 0 {
		return tokens[0]
	}
	return ""
}

func NewInventoryClient(base string, internalToken ...string) *HTTPInventoryClient {
	return &HTTPInventoryClient{BaseURL: strings.TrimRight(base, "/"), InternalToken: firstToken(internalToken), Client: &http.Client{Timeout: 3 * time.Second}}
}
func NewPaymentClient(base string, internalToken ...string) *HTTPPaymentClient {
	return &HTTPPaymentClient{BaseURL: strings.TrimRight(base, "/"), InternalToken: firstToken(internalToken), Client: &http.Client{Timeout: 5 * time.Second}}
}

// doJSON sends JSON; a non-empty internalToken is attached as X-Internal-Token.
func doJSON(client *http.Client, method, url string, in interface{}, out interface{}, internalToken ...string) (int, error) {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return 0, err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	setInternalToken(req, firstToken(internalToken))
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if out != nil && len(data) > 0 {
		_ = json.Unmarshal(data, out)
	}
	if resp.StatusCode == 409 {
		return resp.StatusCode, ErrInsufficientStock
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("upstream %s returned %d: %s", url, resp.StatusCode, string(data))
	}
	return resp.StatusCode, nil
}

func (c *HTTPInventoryClient) Reserve(orderID, productID string, qty int) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/reservations", map[string]interface{}{"orderId": orderID, "productId": productID, "quantity": qty}, nil, c.InternalToken)
	return err
}

func (c *HTTPInventoryClient) Release(orderID string) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/reservations/"+orderID+"/release", map[string]interface{}{}, nil, c.InternalToken)
	return err
}

func (c *HTTPInventoryClient) Restock(orderID, productID string, qty int) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/restock", map[string]interface{}{"orderId": orderID, "productId": productID, "quantity": qty}, nil, c.InternalToken)
	return err
}

func (c *HTTPInventoryClient) Confirm(orderID string) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/reservations/"+orderID+"/confirm", map[string]interface{}{}, nil, c.InternalToken)
	return err
}

var ErrProductNotFound = errors.New("product not found")

type HTTPProductClient struct {
	BaseURL string
	Client  *http.Client
}

func NewProductClient(base string) *HTTPProductClient {
	return &HTTPProductClient{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 3 * time.Second}}
}

// Lookup returns the authoritative catalog name and price for a product.
func (c *HTTPProductClient) Lookup(productID string) (string, float64, error) {
	if c == nil || c.BaseURL == "" {
		return "", 0, errors.New("PRODUCT_URL not configured")
	}
	var out struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}
	resp, err := c.Client.Get(c.BaseURL + "/products/" + productID)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return "", 0, ErrProductNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, fmt.Errorf("product service returned %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", 0, err
	}
	return out.Name, out.Price, nil
}

type PaymentResult struct {
	ID      string  `json:"id"`
	Status  string  `json:"status"`
	Amount  float64 `json:"amount"`
	OrderID string  `json:"orderId"`
}

func (c *HTTPPaymentClient) Pay(orderID, userID string, amount float64, token, idempotencyKey string) (*PaymentResult, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("PAYMENT_URL not configured")
	}
	var out PaymentResult
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/payments", map[string]interface{}{"orderId": orderID, "userId": userID, "amount": amount, "paymentToken": token, "idempotencyKey": idempotencyKey}, &out, c.InternalToken)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// Refund refunds the (latest SUCCEEDED) payment for an order; idempotent server-side.
func (c *HTTPPaymentClient) Refund(orderID string) (*PaymentResult, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("PAYMENT_URL not configured")
	}
	var out PaymentResult
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/payments/order/"+orderID+"/refund", map[string]interface{}{}, &out, c.InternalToken)
	if err != nil {
		return nil, err
	}
	return &out, nil
}
