FROM node:22-alpine

WORKDIR /app

# Copy server and all static files
COPY server.mjs ./
COPY index.html ./
COPY styles.css ./
COPY app.js ./

EXPOSE 3000

CMD ["node", "server.mjs"]
