# Build the demo images into the local cluster and deploy the baseline.
#   make images      build every service at :baseline
#   make deploy      apply the manifests and seed the database
#   make lesson LESSON=swallow-errors
#                    build the one service that lesson changes, tagged with it
#   make clean       remove the namespace
SERVICES := storefront inventory pricing
REGISTRY ?= signadot
TAG      ?= baseline

# How a built image reaches your cluster. minikube and kind can take a local
# image directly; on any other cluster set LOAD to a push and point REGISTRY at
# something the cluster can pull from:
#   make images REGISTRY=ghcr.io/you LOAD="docker push"
LOAD     ?= minikube image load

.PHONY: images deploy lesson clean

images:
	@for s in $(SERVICES); do \
	  docker build -q -t $(REGISTRY)/boxoffice-demo-$$s:$(TAG) -f docker/$$s.Dockerfile . >/dev/null && \
	  $(LOAD) $(REGISTRY)/boxoffice-demo-$$s:$(TAG) && \
	  echo "built and loaded $(REGISTRY)/boxoffice-demo-$$s:$(TAG)"; \
	done

deploy:
	kubectl apply -f k8s/namespace.yaml
	kubectl -n boxoffice create configmap boxoffice-db-init \
	  --from-file=01-schema.sql=db/schema.sql --from-file=02-seed.sql=db/seed.sql \
	  --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -f k8s/
	kubectl -n boxoffice rollout status deploy/postgres --timeout=180s
	kubectl -n boxoffice rollout status deploy/redis --timeout=180s
	@for s in $(SERVICES); do kubectl -n boxoffice rollout status deploy/$$s --timeout=180s; done

# A lesson replaces one service's app.js and is published as a tag on that
# service's image. Nothing else about the deployment changes, so a sandbox can
# fork the service onto the tag and leave the rest of the cluster alone.
lesson:
	@test -n "$(LESSON)" || (echo "usage: make lesson LESSON=<name>" && exit 1)
	@svc=`ls lessons/$(LESSON)`; \
	 tmp=`mktemp -d`; cp -R pkg docker $$tmp/; \
	 cp lessons/$(LESSON)/$$svc/app.js $$tmp/pkg/$$svc/app.js; \
	 docker build -q -t $(REGISTRY)/boxoffice-demo-$$svc:$(LESSON) -f $$tmp/docker/$$svc.Dockerfile $$tmp >/dev/null && \
	 $(LOAD) $(REGISTRY)/boxoffice-demo-$$svc:$(LESSON) && \
	 echo "built $(REGISTRY)/boxoffice-demo-$$svc:$(LESSON) from lessons/$(LESSON)/$$svc"; \
	 rm -rf $$tmp

clean:
	kubectl delete namespace boxoffice --ignore-not-found
