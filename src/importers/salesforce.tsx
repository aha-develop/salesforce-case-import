import React from 'https://cdn.skypack.dev/react';
import { settings } from '../extension';

type ApiResponse = {
  done: boolean;
  totalSize: number;
  records?: Record<string, unknown>[];
  query?: string;
};

type CaseRecord = {
  uniqueId: string;
  name: string;
  url: string;
  caseNumber: string;
  description?: string;
  status?: string;
  priority?: string;
  jsonUrl: string;
};

const importer = aha.getImporter<CaseRecord>(
  'aha-develop.salesforce-case-import.cases'
);

const encodeQuery = (query: string) =>
  encodeURIComponent(query.replace(/\s+/g, ' '));

const apiRequest = async (url: string, base: string = '/services/data/v54.0'): Promise<ApiResponse> => {
  if (!settings.domain) {
    throw new aha.ConfigError(
      'This importer requires the subdomain for your Salesforce account. Please visit Settings > Account > Extensions > Salesforce cases to provide this.'
    );
  }

  const auth = await aha.auth('salesforce', { useCachedRetry: true });

  const apiBaseUrl = `https://${settings.domain}.my.salesforce.com${base}`;
  let response: Response;

  try {
    response = await fetch(apiBaseUrl + url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });
  } catch (e) {
    throw new aha.AuthError(
      'Error fetching data from Salesforce.',
      'salesforce',
      {
        displayError: (
          <>
            <p>Error fetching data from Salesforce.</p>
            <p>
              1. Check your Salesforce subdomain is correct in Settings &gt;
              Account &gt; Extensions &gt; Salesforce cases.
            </p>
            <p>
              2. Salesforce requires that you grant permission to Aha! to fetch
              data over the API. Visit Setup &gt; Security &gt; CORS in
              Salesforce to add <strong>{window.location.origin}</strong> to
              your CORS allow list.
            </p>
            <p>
              3. Your auth token may have expired, try authenticating using the
              button below.
            </p>
          </>
        ),
      }
    );
  }

  if (response.ok) {
    return response.json();
  }

  if (response.status === 401) {
    throw new aha.AuthError(
      `Salesforce authentication error: ${response.status}`,
      'salesforce'
    );
  } else {
    throw new Error(`Salesforce API error: ${response.status}`);
  }
};

importer.on({ action: 'listFilters' }, async () => ({
  listViewId: {
    title: 'List view',
    required: true,
    type: 'select',
  },
}));

importer.on({ action: 'filterValues' }, async ({ filterName }) => {
  if (filterName === 'listViewId') {
    const query = `
      SELECT Id, Name FROM ListView WHERE SobjectType = 'Case'
    `.trim();
    const listViews = await apiRequest(`/query/?q=${encodeQuery(query)}`);
    return listViews.records.map(({ Name, Id }) => ({
      text: Name,
      value: Id,
    }));
  }
  return [];
});

importer.on({ action: 'listCandidates' }, async ({ filters }) => {
  if (!filters.listViewId) {
    return { records: [] };
  }

  const describe = await apiRequest(
    `/sobjects/Case/listviews/${filters.listViewId}/describe`
  );

  const apiResponse = await apiRequest(
    `/query/?q=${encodeQuery(describe.query)}`
  );

  return {
    records: apiResponse.records.map(item => ({
      uniqueId: item.Id,
      name: item.Subject,
      url: `https://${settings.domain}.lightning.force.com/lightning/r/Case/${item.Id}/view`,
      caseNumber: item.CaseNumber,
      description: item.Description,
      status: item.Status,
      priority: item.Priority,
      jsonUrl: item.attributes.url
    })),
  };
});

importer.on({ action: 'renderRecord' }, ({ record }) => (
  <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
    <div style={{ flexGrow: 1 }}>
      <div className='card__row'>
        <div className='card__section'>
          <div className='card__field'>
            <span className='text-muted'>{record.caseNumber}</span>
          </div>
        </div>
        <div className='card__section'>
          <div className='card__field'>
            <a
              href={aha.sanitizeUrl(record.url)}
              target='_blank'
              rel='noopener noreferrer'
            >
              <i className='text-muted fa-solid fa-external-link' />
            </a>
          </div>
        </div>
      </div>
      <div className='card__row'>
        <div className='card__section'>
          <div className='card__field'>
            <a
              href={aha.sanitizeUrl(record.url)}
              target='_blank'
              rel='noopener noreferrer'
            >
              {record.name}
            </a>
          </div>
        </div>
      </div>
      <div className='card__row'>
        <div className='card__section'>
          <div className='card__field'>
            <aha-pill color='var(--theme-button-pill)'>
              {record.status}
            </aha-pill>
          </div>
        </div>
      </div>
    </div>
  </div>
));

importer.on({ action: 'importRecord' }, async ({ importRecord, ahaRecord }) => {
  let description = `<p><a href="${importRecord.url}">View in Salesforce</a></p>`;

  if (importRecord.description) {
    description = `<p>${importRecord.description.replace(
      /\r\n/g,
      '<br>'
    )}</p>${description}`;
  } else {
    try {
      const caseDetails = await apiRequest(importRecord.jsonUrl, '')
      description = `<p>${caseDetails.Description.replace(
        /\r\n/g,
        '<br>'
      )}</p>${description}`;
    } catch (e) {
      console.warn("Unable to fetch description", e)
    }
  }

  ahaRecord.description = description as unknown as Aha.Note;
  await ahaRecord.save();
});
