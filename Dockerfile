FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "cloud-backend.js"]
