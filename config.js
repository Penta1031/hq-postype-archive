window.POSTYPE_CONFIG = {
  DATA_SOURCE: "auto",

  // Supabase Dashboard > Connect 또는 Project Settings > API에서 복사해 넣기
  SUPABASE_URL: "https://aiuwbwtknaceghkzporx.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdXdid3RrbmFjZWdoa3pwb3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjM0MTEsImV4cCI6MjA5NzA5OTQxMX0.8SRwD8aS_UiPHMKsLw6O5wIZo4rc-Ep5bT3MljmQHIE",

  SUPABASE_TABLE: "postype_archive",
  SUPABASE_WRITE_ENABLED: true,

  // Supabase 연결이 비어 있을 때만 로컬 CSV를 읽습니다.
  LOCAL_CSV_URL: "data/postype_archive_series_columns_limited.csv"
};
