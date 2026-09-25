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

export type WindGridRecord = {
  header: {
    parameterCategory: 2;
    parameterNumber: 2 | 3;
    nx: number;
    ny: number;
    lo1: number;
    lo2: number;
    la1: number;
    la2: number;
    dx: number;
    dy: number;
    refTime: string;
    forecastTime: 0;
  };
  data: number[];
};

export type WindResponse = {
  records: [WindGridRecord, WindGridRecord];
  observedAt: string;
  checkedAt: string;
  pointCount: number;
  maxSpeed: number;
  source: 'ECMWF IFS HRES 9 km';
  sampleStep: number;
  stale?: boolean;
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
