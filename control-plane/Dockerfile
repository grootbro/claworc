FROM node:22-alpine AS frontend

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ .
RUN npx vite build

FROM golang:1.24-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build

ARG VERSION=""

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend /build/frontend/dist /build/frontend/dist

RUN EFFECTIVE_VERSION="${VERSION}" && \
    if [ -z "${EFFECTIVE_VERSION}" ] && [ -f VERSION ]; then EFFECTIVE_VERSION="$(tr -d '\r\n' < VERSION)"; fi && \
    if [ -z "${EFFECTIVE_VERSION}" ]; then EFFECTIVE_VERSION="0.1.0"; fi && \
    BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" && \
    LD_FLAGS="-X 'main.BuildDate=${BUILD_DATE}' -X 'main.Version=${EFFECTIVE_VERSION}'" && \
    CGO_ENABLED=1 go build -ldflags "${LD_FLAGS}" -o claworc .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates sqlite-libs

WORKDIR /app

COPY --from=builder /build/claworc /app/claworc

EXPOSE 8000

ENTRYPOINT ["/app/claworc"]
