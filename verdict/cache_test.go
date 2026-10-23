package main

import (
	"context"
	"testing"
)

func TestMemCache_SetGetRoundTrip(t *testing.T) {
	c := newMemCache()
	ctx := context.Background()

	if _, ok, err := c.Get(ctx, "missing"); err != nil || ok {
		t.Fatalf("expected miss, got ok=%v err=%v", ok, err)
	}

	if err := c.Set(ctx, "k1", "hello"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	val, ok, err := c.Get(ctx, "k1")
	if err != nil || !ok {
		t.Fatalf("expected hit, got ok=%v err=%v", ok, err)
	}
	if val != "hello" {
		t.Fatalf("expected %q, got %q", "hello", val)
	}
}

func TestMemCache_Overwrite(t *testing.T) {
	c := newMemCache()
	ctx := context.Background()
	_ = c.Set(ctx, "k", "a")
	_ = c.Set(ctx, "k", "b")
	val, ok, _ := c.Get(ctx, "k")
	if !ok || val != "b" {
		t.Fatalf("expected overwritten value %q, got %q (ok=%v)", "b", val, ok)
	}
}

func TestNewCache_NoRedisURL_FallsBackToMemory(t *testing.T) {
	cache, backend := newCache(context.Background(), "")
	if backend != "memory" {
		t.Fatalf("expected memory backend, got %q", backend)
	}
	if _, ok := cache.(*memCache); !ok {
		t.Fatalf("expected *memCache, got %T", cache)
	}
}

func TestNewCache_UnreachableRedis_FallsBackToMemory(t *testing.T) {
	// Port 1 is not a valid redis endpoint; ping should fail fast and fall back.
	cache, backend := newCache(context.Background(), "redis://127.0.0.1:1/0")
	if backend != "memory" {
		t.Fatalf("expected memory fallback for unreachable redis, got %q", backend)
	}
	if _, ok := cache.(*memCache); !ok {
		t.Fatalf("expected *memCache, got %T", cache)
	}
}
