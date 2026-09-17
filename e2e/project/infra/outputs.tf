output "e2e_gateway_domain" {
  value = yandex_api_gateway.e2e_openapi.domain
}

output "e2e_container_url" {
  value = yandex_serverless_container.e2e_container.url
}

output "e2e_worker_events_name" {
  value = yandex_message_queue.e2e_worker_events.name
}

output "e2e_worker_dlq_events_name" {
  value = yandex_message_queue.e2e_worker_dlq_events.name
}

output "e2e_worker_app_dlq_name" {
  value = yandex_message_queue.e2e_worker_app_dlq.name
}
