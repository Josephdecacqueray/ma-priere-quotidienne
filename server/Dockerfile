FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY merge.js index.js ./
EXPOSE 8080
CMD ["node", "index.js"]
