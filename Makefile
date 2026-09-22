# alikoaik.com — zero-dependency static portfolio site.
#
# There is no bundler and no package manager. `build` is a copy: it
# stages src/ plus the domain's CNAME into dist/ so the deployed tree
# has the pages at its root, which is what GitHub Pages serves.

SRC     := src
DIST    := dist
PORT    ?= 8080
BRANCH  ?= gh-pages

.DEFAULT_GOAL := help
.PHONY: help serve build clean deploy check

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-8s\033[0m %s\n",$$1,$$2}'

serve: ## Serve src/ at http://localhost:$(PORT)
	@echo "→ http://localhost:$(PORT)"
	@cd $(SRC) && python3 -m http.server $(PORT)

build: clean ## Stage the deployable tree in dist/
	@mkdir -p $(DIST)
	@cp -R $(SRC)/. $(DIST)/
	@[ -f CNAME ] && cp CNAME $(DIST)/ || true
	@echo "built $(DIST)/"

clean: ## Remove dist/
	@rm -rf $(DIST)

check: ## Verify every local src/href in src/ resolves
	@fail=0; \
	for f in $(SRC)/*.html; do \
	  for ref in $$(grep -oE '(src|href)="[^"#:]+\.(js|css)"' $$f \
	      | sed -E 's/.*="([^"]+)"/\1/'); do \
	    [ -f "$(SRC)/$$ref" ] || { echo "missing: $$f -> $$ref"; fail=1; }; \
	  done; \
	done; \
	[ $$fail -eq 0 ] && echo "all references resolve"

deploy: build ## Publish dist/ to the $(BRANCH) branch
	@tmp=$$(mktemp -d); \
	cp -R $(DIST)/. $$tmp/; \
	cd $$tmp && git init -q && git checkout -qB $(BRANCH) \
	  && git add -A \
	  && git -c user.name="$$(git -C $(CURDIR) config user.name)" \
	         -c user.email="$$(git -C $(CURDIR) config user.email)" \
	         commit -qm "Deploy $$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	  && git push -qf "$$(git -C $(CURDIR) remote get-url origin)" \
	         $(BRANCH):$(BRANCH); \
	status=$$?; rm -rf $$tmp; \
	[ $$status -eq 0 ] && echo "pushed to $(BRANCH) — set Pages source to that branch"
