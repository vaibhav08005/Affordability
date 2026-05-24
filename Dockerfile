FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

ENV CI=true

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY public ./public
COPY samples ./samples

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV HEADLESS=true
ENV BROWSER_EXECUTION_MODE=managed
ENV AUTOMATION_TIMEOUT_MS=60000
ENV SCREENSHOT_DIR=/tmp/screenshots

EXPOSE 8080

CMD ["node", "dist/server.js"]
