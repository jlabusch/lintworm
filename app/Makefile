.PHONY: lint test

DOCKER=docker
COMPOSE=docker-compose

lint:
	$(DOCKER) exec -it $$($(COMPOSE) ps | grep app_1 | awk '{print $$1}') ./node_modules/.bin/eslint ./index.js ./lib/*.js

test:
	$(COMPOSE) build app
	mkdir -p ../coverage
	$(DOCKER) run -it --rm \
        -v $$(dirname $$PWD)/test:/opt/test:ro \
        -v $$(dirname $$PWD)/coverage:/opt/coverage \
        -v $$(dirname $$PWD)/app/lib:/opt/lib:ro \
        -v $$(dirname $$PWD)/app/index.js:/opt/index.js:ro \
        -v $$(dirname $$PWD)/config:/opt/config:ro \
        $$(grep image ../docker-compose.yml | awk '{print $$NF}') \
        test
