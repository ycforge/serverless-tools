interface ApiGatewayEvent {
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
}

function header(event: ApiGatewayEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

export const handler = async (event: ApiGatewayEvent) => {
  // Accept either a custom header or a query parameter: API Gateway forwards
  // the query string verbatim to a function authorizer, which makes the
  // e2e allow-path deterministic.
  const allow =
    header(event, 'x-e2e-auth') === 'allow' || event.queryStringParameters?.auth === 'allow';
  return {
    isAuthorized: allow,
    context: { subject: allow ? 'e2e-user' : 'anonymous' },
  };
};
