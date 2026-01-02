FROM node:25-trixie

WORKDIR /app
COPY . .

RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=9000

CMD ["npm", "start"]
