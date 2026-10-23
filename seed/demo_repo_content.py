"""The storefront source files that demo-repo is built from.

Pure data: file templates for the small Python codebase (checkout/payments/
inventory/shared), plus the handful of static files with no fences in them.
Each `@@<fence-id>@@` marker in a template sits on its own line, at the
indentation its fence's final `code` line needs, and gets swapped by
repo_builder.py for either a scaffold placeholder or the fence's real code.
"""
from __future__ import annotations

FILE_TEMPLATES = {
    "services/payments/client.py": '''"""HTTP client for the payments provider."""

import time

@@retry-cap@@
@@payments-backoff-seconds@@
@@payments-timeout-seconds@@
@@payments-default-currency@@


class PaymentError(Exception):
    pass


def charge(card_token, amount_cents, currency=None):
    """Charge a card through the payments provider, retrying on failure."""
    currency = currency or DEFAULT_CURRENCY
    attempt = 0
    while attempt < MAX_RETRIES:
        try:
            return _send_charge_request(card_token, amount_cents, currency)
        except PaymentError:
            attempt += 1
            time.sleep(BACKOFF_SECONDS * attempt)
    raise PaymentError("charge failed after %d attempts" % MAX_RETRIES)


def _send_charge_request(card_token, amount_cents, currency):
    if amount_cents <= 0:
        @@payments-positive-charge@@
    return {
        "status": "ok",
        "amount_cents": amount_cents,
        "currency": currency,
        "timeout": TIMEOUT_SECONDS,
    }


def refund(charge_id, amount_cents):
    if amount_cents <= 0:
        @@payments-positive-refund@@
    return {"status": "refunded", "charge_id": charge_id, "amount_cents": amount_cents}
''',
    "services/payments/provider.py": '''"""Low-level wrapper around the payments provider's HTTP API."""

_SEEN_REQUEST_IDS = set()


def send(request_id, payload):
    """Send a request to the provider, ignoring ones we have already sent."""
    @@payments-dedupe-provider-call@@
        return {"status": "duplicate_ignored", "request_id": request_id}
    _SEEN_REQUEST_IDS.add(request_id)
    return {"status": "sent", "request_id": request_id, "payload": payload}
''',
    "services/checkout/api.py": '''"""Checkout API: validates and charges carts."""

from services.payments import client as payments_client

SEEN_IDEMPOTENCY_KEYS = set()

@@checkout-timeout-comment@@
CHECKOUT_TIMEOUT_SECONDS = 30


def checkout(cart, idempotency_key, shipping_address, currency="USD"):
    @@idempotency-key-check@@
        return {"status": "duplicate_ignored", "idempotency_key": idempotency_key}
    @@checkout-address-required@@
        raise ValueError("shipping address is required")
    @@checkout-currency-lock@@
        raise ValueError("only USD checkouts are supported")

    total_cents = cart.total_cents()
    result = payments_client.charge(cart.card_token, total_cents, currency)
    SEEN_IDEMPOTENCY_KEYS.add(idempotency_key)
    return result
''',
    "services/checkout/cart.py": '''"""Shopping cart model."""

MAX_CART_ITEMS = 50


class Item:
    def __init__(self, sku, price_cents, qty):
        self.sku = sku
        self.price_cents = price_cents
        self.qty = qty


class Cart:
    def __init__(self, card_token, items):
        self.card_token = card_token
        self.items = items

    def total_cents(self):
        total_cents = sum(item.price_cents * item.qty for item in self.items)
        @@checkout-min-cart-total@@
            raise ValueError("cart total must be positive")
        return total_cents

    def add_item(self, item):
        @@checkout-max-items@@
            raise ValueError("cart is full")
        self.items.append(item)
''',
    "services/inventory/stock.py": '''"""Inventory stock tracking and reservation."""

@@inventory-reservation-expiry@@


class OversellError(Exception):
    pass


class Stock:
    def __init__(self, sku, available):
        self.sku = sku
        self.available = available

    def reserve(self, quantity):
        @@oversell-guard@@
            raise OversellError(
                "cannot reserve %d of %s, only %d available"
                % (quantity, self.sku, self.available)
            )
        self.available -= quantity
        return {"sku": self.sku, "reserved": quantity, "remaining": self.available}

    def restock(self, quantity):
        @@inventory-negative-restock@@
            raise ValueError("restock quantity must be non-negative")
        self.available += quantity
        return self.available


def describe(stock):
    label = "%s: %d available" % (stock.sku, stock.available)
    return label
''',
    "services/shared/util.py": '''"""Shared helpers used across checkout, payments and inventory."""

import time

@@shared-retry-sleep-cap@@


def sleep_with_cap(seconds):
    time.sleep(min(seconds, MAX_SLEEP_SECONDS))


def validate_idempotency_key(key):
    @@shared-idempotency-key-length@@
        raise ValueError("idempotency key must be at least 16 characters")
    return key
''',
}

# Plain files with no fence markers.
STATIC_FILES = {
    "services/__init__.py": "",
    "services/payments/__init__.py": "",
    "services/checkout/__init__.py": "",
    "services/inventory/__init__.py": "",
    "services/shared/__init__.py": "",
    "README.md": (
        "# storefront\n\n"
        "A small internal storefront: checkout, payments and inventory "
        "services.\n"
    ),
}
