FROM node:8

WORKDIR /opt

COPY *.json *.monkeypatch *.js ./

COPY lib ./lib/

COPY config ./config/

RUN npm install

RUN patch -p0 < bunyan.monkeypatch

ENTRYPOINT ["npm"]
