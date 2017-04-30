.PHONY: test clean

test:
	make -C app test

clean:
	rm -fr coverage

