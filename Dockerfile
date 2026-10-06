# palaver relay. Build: docker build -t palaver .
# Run:   docker run -d -p 7777:7777 -e PALAVER_TOKEN=... palaver
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY lib ./lib
USER node
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:7777/healthz || exit 1
# Inside the container listen on every interface; restrict exposure with the -p mapping.
CMD ["node", "bin/palaver.js", "relay", "--host", "0.0.0.0", "--port", "7777"]
