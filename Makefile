.PHONY: app test run clean

COMPOSE=docker-compose

test:
	make -C app test

build:
	$(COMPOSE) build

run: build
	$(COMPOSE) up -d; $(COMPOSE) logs -f

clean:
	test -e ./coverage/* && sudo rm -fr coverage || :

