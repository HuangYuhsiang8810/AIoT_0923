export type ElementValue = {
  label: string;
  value: string;
  unit: string | null;
};

export type WeatherPeriod = {
  startTime: string;
  endTime: string;
  elements: Record<string, ElementValue>;
};

export type WeatherLocation = {
  locationName: string;
  periods: WeatherPeriod[];
};

export type WeatherResponse = {
  locations: WeatherLocation[];
  count: number;
};

export type WeatherRow = {
  datasetId: string;
  locationName: string;
  elementName: string;
  startTime: string;
  endTime: string;
  value: string;
  unit: string | null;
  syncedAt: string;
};

export type StatusResponse = {
  database: {
    provider: 'neon' | 'memory';
    rowCount: number;
    locationCount: number;
    syncedAt: string | null;
  };
  lastRun: {
    status: 'success' | 'failed' | 'running';
    recordCount: number;
    errorMessage: string | null;
    completedAt: string | null;
  } | null;
};
