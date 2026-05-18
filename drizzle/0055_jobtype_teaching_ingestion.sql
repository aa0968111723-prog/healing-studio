-- 0055: 擴充 background_jobs.jobType ENUM 加入 teaching_archive_ingestion
--
-- teachingArchiveIngestionWorker 把 fire-and-forget setImmediate 改成
-- backgroundJobs queue。新的 jobType 值要先進 enum 才能 INSERT，否則
-- worker 第一次 createBackgroundJob 就會炸 Data truncated for column。

ALTER TABLE `background_jobs`
  MODIFY COLUMN `jobType` enum(
    'image',
    'video',
    'audio',
    'voice',
    'zip_export',
    'multimodal',
    'model_training',
    'teaching_archive_ingestion'
  ) NOT NULL;
