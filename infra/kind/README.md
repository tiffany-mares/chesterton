# Chesterton on kind (local-only, optional)

Kubernetes manifests mirroring `infra/docker-compose.yml` — same images, env,
and service-name DNS, so no code changes are needed. Per `docs/outline.md`
Kubernetes is the stretch goal and "first thing cut"; these manifests are
**YAML-validated but untested against a live cluster** (no kind/kubectl on the
dev machine).

Intended workflow:

```bash
# 1. Build the images with compose (once):
cd infra && docker compose build

# 2. Create a cluster and load the local images (imagePullPolicy: Never):
kind create cluster --name chesterton
for img in seed mocks diff-analyzer triage verdict gateway ledger dashboard; do
  kind load docker-image "infra-$img:latest" --name chesterton
done

# 3. Apply, wait, then port-forward the user-facing services:
kubectl apply -f infra/kind/chesterton.yaml
kubectl -n chesterton wait --for=condition=available deploy --all --timeout=300s
kubectl -n chesterton port-forward svc/gateway 4000:4000 &
kubectl -n chesterton port-forward svc/mocks 4100:4100 &
kubectl -n chesterton port-forward svc/dashboard 4600:4600 &

# 4. Import knowledge + warm the demo, same as compose (see docs/runbook.md).
```

Caveats vs. compose:
- The seed Job and the mocks Deployment share one RWO PVC — fine on kind's
  single node, not portable to multi-node clusters as-is.
- No equivalent of compose's `service_completed_successfully` ordering:
  readiness probes make mocks crash-loop harmlessly until the seed Job
  finishes. For strict ordering, gate mocks with an initContainer that waits
  for `/seed/out/knowledge.json`.
- Secrets are inlined as plain env (`devsecret`) because this is mock-mode
  only; a hybrid-mode port would move `.env` values into a `Secret`.
