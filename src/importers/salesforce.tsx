import React from 'https://cdn.skypack.dev/react';
import { settings } from '../extension';

type ApiResponse = {
  done: boolean;
  totalSize: number;
  records: {
    Id: string;
    Subject: string;
    Description: string | null;
    CaseNumber: string;
    Status: string | null;
    Priority: string | null;
  }[];
};

type CaseRecord = {
  uniqueId: string;
  name: string;
  url: string;
  caseNumber: string;
  description?: string;
  status?: string;
  priority?: string;
};

const importer = aha.getImporter<CaseRecord>(
  'aha-develop.salesforce-case-import.cases'
);

const apiRequest = async (url: string): Promise<ApiResponse> => {
  const auth = await aha.auth('salesforce', { useCachedRetry: true });

  const response = await fetch(
    `https://${settings.domain}.my.salesforce.com${url}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    }
  );

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
  case_type: {
    title: 'Case Type',
    required: true,
    type: 'select',
  },
}));

importer.on({ action: 'filterValues' }, async ({ filterName }) => {
  if (filterName === 'case_type') {
    return [
      {
        text: 'Open cases',
        value: 'open',
      },
      {
        text: 'Closed cases',
        value: 'closed',
      },
    ];
  }
  return [];
});

importer.on({ action: 'listCandidates' }, async ({ filters }) => {
  if (!filters.case_type) {
    return { records: [] };
  }

  const query = `
      SELECT Id, Subject, Description, CaseNumber, Status, Priority
      FROM Case
      WHERE IsClosed = ${filters.case_type === 'open' ? 'false' : 'true'}
    `.trim();

  const apiResponse = await apiRequest(
    `/services/data/v54.0/query/?q=${encodeURIComponent(
      query.replace(/\s+/g, ' ')
    )}`
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
  // @ts-ignore
  ahaRecord.description = `<p>${importRecord.description.replace(
    /\r\n/g,
    '<br>'
  )}</p><p><a href="${importRecord.url}">View in Salesforce</a></p>`;
  await ahaRecord.save();
});
