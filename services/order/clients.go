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
	BaseURL string
	Client  *http.Client
}

type HTTPPaymentClient struct {
	BaseURL string
	Client  *http.Client
}

func NewInventoryClient(base string) *HTTPInventoryClient {
	return &HTTPInventoryClient{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 3 * time.Second}}
}
func NewPaymentClient(base string) *HTTPPaymentClient {
	return &HTTPPaymentClient{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 5 * time.Second}}
}

func doJSON(client *http.Client, method, url string, in interface{}, out interface{}) (int, error) {
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
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/reservations", map[string]interface{}{"orderId": orderID, "productId": productID, "quantity": qty}, nil)
	return err
}

func (c *HTTPInventoryClient) Release(orderID string) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/reservations/"+orderID+"/release", map[string]interface{}{}, nil)
	return err
}

func (c *HTTPInventoryClient) Restock(productID string, qty int) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/restock", map[string]interface{}{"productId": productID, "quantity": qty}, nil)
	return err
}

func (c *HTTPInventoryClient) Confirm(orderID string) error {
	if c == nil || c.BaseURL == "" {
		return errors.New("INVENTORY_URL not configured")
	}
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/internal/reservations/"+orderID+"/confirm", map[string]interface{}{}, nil)
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
	_, err := doJSON(c.Client, "POST", c.BaseURL+"/payments", map[string]interface{}{"orderId": orderID, "userId": userID, "amount": amount, "paymentToken": token, "idempotencyKey": idempotencyKey}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}
