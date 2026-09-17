interface ApiGatewayEvent {
  headers?: Record<string, string | undefined>;
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
  const allow = header(event, 'x-e2e-auth') === 'allow';
  return {
    isAuthorized: allow,
    context: { subject: allow ? 'e2e-user' : 'anonymous' },
  };
};
