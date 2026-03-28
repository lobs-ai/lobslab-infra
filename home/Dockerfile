FROM node:22-alpine

WORKDIR /app

# Copy server and all static files
COPY server.mjs ./
COPY index.html ./
COPY styles.css ./
COPY app.js ./

# Ensure data dir exists (mounted as volume in production)
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.mjs"]
