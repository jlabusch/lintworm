FROM node:7.8

WORKDIR /opt

COPY *.json *.monkeypatch index.js ./
COPY lib ./lib/
COPY config ./config/

RUN npm install

RUN patch -p0 < bunyan.monkeypatch

ENTRYPOINT ["npm"]
