FROM node:22-alpine AS frontend

ARG VITE_PRODUCT_NAME=Claworc
ARG VITE_PRODUCT_SHORT_NAME=Claworc
ARG VITE_PRODUCT_TAGLINE=OpenClaw Orchestrator
ENV VITE_PRODUCT_NAME=$VITE_PRODUCT_NAME
ENV VITE_PRODUCT_SHORT_NAME=$VITE_PRODUCT_SHORT_NAME
ENV VITE_PRODUCT_TAGLINE=$VITE_PRODUCT_TAGLINE

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ .
RUN npx vite build

FROM golang:1.24-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend /build/frontend/dist /build/frontend/dist

RUN CGO_ENABLED=1 go build -ldflags "-X main.BuildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" -o claworc .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates sqlite-libs

WORKDIR /app

COPY --from=builder /build/claworc /app/claworc

EXPOSE 8000

ENTRYPOINT ["/app/claworc"]
