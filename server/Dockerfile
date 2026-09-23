FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/src ./src
# shared/sim по architecture.md: один код клиента и сервера
COPY src/game/sim.js ./client-sim/sim.js
COPY src/game/data ./client-sim/data
COPY src/game/missions.js ./client-sim/missions.js
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
