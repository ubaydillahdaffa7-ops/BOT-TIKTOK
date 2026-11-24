FROM node:20-alpine
ENV NODE_ENV=production PORT=3000 APP_DATA_DIR=/app/.data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
