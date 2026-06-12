export default {
  async fetch(request) {
    // Responde preflight CORS
    if(request.method === 'OPTIONS'){
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const BASE = 'https://api.football-data.org/v4/competitions/2000';
    const TOKEN = '7c8dee4d630e4758a5a6cc7ff9304206';

    const url = new URL(request.url);
    const path = url.searchParams.get('path') || 'matches';
    const status = url.searchParams.get('status') || '';

    let apiUrl = `${BASE}/${path}`;
    if(status) apiUrl += `?status=${status}`;

    const resp = await fetch(apiUrl, {
      headers: { 'X-Auth-Token': TOKEN }
    });
    const data = await resp.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  }
}
