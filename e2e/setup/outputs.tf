output "static_bucket" {
  value = yandex_storage_bucket.static.bucket
}

output "jwt_bucket" {
  value = yandex_storage_bucket.jwt.bucket
}

output "jwt_issuer" {
  value = "https://${yandex_storage_bucket.jwt.bucket}.storage.yandexcloud.net"
}

output "kms_key_id" {
  value = yandex_kms_symmetric_key.e2e.id
}
