FILES := manifest.json \
         $(wildcard _locales/*/messages.json) \
         $(wildcard background/*.js) \
         $(wildcard content/*.js) \
         $(wildcard popup/*) \
         icon.svg \
         README.md

.PHONY: package test clean

package: $(FILES) Makefile
	rm -f video-bg-play-plus.xpi
	zip -r video-bg-play-plus.xpi $(FILES)

test:
	node --test tests/*.test.js

clean:
	rm -f video-bg-play.xpi video-bg-play-plus.xpi
	rm -rf web-ext-artifacts
