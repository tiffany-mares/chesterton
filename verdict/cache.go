package main

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// cache stores the full per-hunk (or per-comment) result JSON, keyed
// "repo:head_sha:hunk_hash" (or "repo:head_sha:stale:<file>:<line>"). A hit
// must skip the corresponding Estelle call and return byte-identical JSON.
type cache interface {
	Get(ctx context.Context, key string) (string, bool, error)
	Set(ctx context.Context, key string, value string) error
}

// --- in-process fallback ---

type memCache struct {
	mu   sync.RWMutex
	data map[string]string
}

func newMemCache() *memCache {
	return &memCache{data: make(map[string]string)}
}

func (m *memCache) Get(_ context.Context, key string) (string, bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.data[key]
	return v, ok, nil
}

func (m *memCache) Set(_ context.Context, key string, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = value
	return nil
}

// --- redis-backed cache ---

type redisCache struct {
	client *redis.Client
}

func (r *redisCache) Get(ctx context.Context, key string) (string, bool, error) {
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return val, true, nil
}

func (r *redisCache) Set(ctx context.Context, key string, value string) error {
	return r.client.Set(ctx, key, value, 0).Err()
}

// newCache picks a backend per task-6-brief.md: use go-redis ONLY if
// REDIS_URL is set AND reachable at startup (pinged with a short timeout);
// otherwise fall back to the in-process map. Logs which backend was chosen.
func newCache(ctx context.Context, redisURL string) (cache, string) {
	if redisURL == "" {
		log.Printf("cache: no REDIS_URL set, using in-process map")
		return newMemCache(), "memory"
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("cache: invalid REDIS_URL (%v), falling back to in-process map", err)
		return newMemCache(), "memory"
	}

	client := redis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
	defer cancel()

	if err := client.Ping(pingCtx).Err(); err != nil {
		log.Printf("cache: redis at %s unreachable (%v), falling back to in-process map", redisURL, err)
		_ = client.Close()
		return newMemCache(), "memory"
	}

	log.Printf("cache: using redis at %s", redisURL)
	return &redisCache{client: client}, "redis"
}
