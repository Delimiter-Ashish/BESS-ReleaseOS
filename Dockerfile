# ReleaseOS — production image (Node 22). State lives on a mounted volume (RELEASEOS_DATA_DIR), never in the image.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# postinstall installs + builds packages/release-core; devDependencies are needed for `next build`.
RUN npm ci --no-audit --no-fund && npm run build
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
