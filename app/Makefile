.PHONY: test

DOCKER=docker
COMPOSE=docker-compose

test:
	$(COMPOSE) build app
	mkdir -p ../coverage
	$(DOCKER) run -it --rm \
        -v $$(dirname $$PWD)/test:/opt/test:ro \
        -v $$(dirname $$PWD)/coverage:/opt/coverage \
        -v $$(dirname $$PWD)/app/lib:/opt/lib:ro \
        -v $$(dirname $$PWD)/app/index.js:/opt/index.js:ro \
        -v $$(dirname $$PWD)/app/.eslintrc.json:/opt/.eslintrc.json:ro \
        -v $$(dirname $$PWD)/config:/opt/config:ro \
        $$(grep image ../docker-compose.yml | awk '{print $$NF}') \
        test
