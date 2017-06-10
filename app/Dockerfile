FROM node:7.8

WORKDIR /opt

COPY *.json *.monkeypatch ./

RUN npm install

RUN patch -p0 < bunyan.monkeypatch

ENTRYPOINT ["npm"]
