.PHONY: app test clean

test:
	make -C app test

build:
	docker-compose build

clean:
	test -e ./coverage/* && sudo rm -fr coverage || :

