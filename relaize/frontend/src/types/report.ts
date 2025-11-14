export interface MetricPair {
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface ReportSection {
  title: string;
  summary: string;
  metrics: MetricPair[];
}

export interface ReportResponse {
  task_id: string;
  generated_at: string;
  overview: string;
  sections: ReportSection[];
  recommendations: string[];
}
