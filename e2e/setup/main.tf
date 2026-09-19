terraform {
  required_version = ">= 1.5"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.145.0"
    }
  }
}

provider "yandex" {}

variable "run_id" {
  type        = string
  description = "Per-run suffix making globally-unique bucket names collision-free."
}

resource "yandex_storage_bucket" "static" {
  bucket = "e2e-static-${var.run_id}"
  acl    = "public-read"
}

resource "yandex_storage_object" "static_hello" {
  bucket       = yandex_storage_bucket.static.id
  key          = "hello.txt"
  source       = "${path.module}/fixtures/hello.txt"
  content_type = "text/plain"
  acl          = "public-read"
}

resource "yandex_storage_bucket" "jwt" {
  bucket = "e2e-jwt-${var.run_id}"
  acl    = "public-read"
}

resource "yandex_storage_object" "openid_configuration" {
  bucket       = yandex_storage_bucket.jwt.id
  key          = ".well-known/openid-configuration"
  source       = "${path.module}/fixtures/openid-configuration.json"
  content_type = "application/json"
  acl          = "public-read"
}

resource "yandex_storage_object" "jwks" {
  bucket       = yandex_storage_bucket.jwt.id
  key          = ".well-known/jwks.json"
  source       = "${path.module}/fixtures/jwks.json"
  content_type = "application/json"
  acl          = "public-read"
}

resource "yandex_kms_symmetric_key" "e2e" {
  name              = "e2e-kms-${var.run_id}"
  default_algorithm = "AES_256"
  rotation_period   = "8760h"
}
