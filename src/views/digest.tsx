import type { ReadNightResult } from '../digest/types.js';

const missing = '—';

export function DigestPage({ result }: { result: Extract<ReadNightResult, { kind: 'found' }> }) {
  return (
    <>
      <h1>digest · {result.night}</h1>
      {result.malformedLineCount > 0 && (
        <p class="warn">malformed lines: {result.malformedLineCount}</p>
      )}
      {result.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first at</th>
              <th>last at</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? missing}</td>
                <td>{row.runs}</td>
                <td>{row.retries >= 3 ? <span class="warn">{row.retries}</span> : row.retries}</td>
                <td>{row.lastStatus === 'fail' ? <span class="warn">fail</span> : row.lastStatus}</td>
                <td>{row.lastError ?? missing}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
