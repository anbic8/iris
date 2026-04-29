CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    email       VARCHAR(255)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin    BOOLEAN       NOT NULL DEFAULT FALSE,
    max_hr      INT           DEFAULT NULL,
    birth_year  INT           DEFAULT NULL,
    weight_kg   DECIMAL(5,2)  DEFAULT NULL,
    hr_zones      TEXT          DEFAULT NULL,
    resting_hr    INT           DEFAULT NULL,
    gender        ENUM('male','female') DEFAULT 'male',
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT          NOT NULL,
    sport_type       ENUM('running','cycling','hiking','other') NOT NULL DEFAULT 'other',
    start_time       DATETIME     NOT NULL,
    duration_s       INT          NOT NULL,
    distance_m       DECIMAL(10,2) NOT NULL,
    elevation_gain_m DECIMAL(8,2)  DEFAULT NULL,
    avg_hr           INT          DEFAULT NULL,
    max_hr           INT          DEFAULT NULL,
    avg_pace         DECIMAL(8,2)  DEFAULT NULL,
    gpx_file_path    VARCHAR(500)  DEFAULT NULL,
    notes            TEXT          DEFAULT NULL,
    created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_activity (user_id, start_time),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trackpoints (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    activity_id INT          NOT NULL,
    lat         DECIMAL(10,7) NOT NULL,
    lon         DECIMAL(10,7) NOT NULL,
    elevation   DECIMAL(8,2)  DEFAULT NULL,
    hr          INT           DEFAULT NULL,
    timestamp   DATETIME      NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS personal_records (
    user_id       INT          NOT NULL,
    distance_km   DECIMAL(6,3) NOT NULL,
    best_s        INT          NOT NULL,
    pace_min_km   DECIMAL(8,3) NOT NULL,
    activity_id   INT          DEFAULT NULL,
    recorded_at   DATETIME     DEFAULT NULL,
    PRIMARY KEY (user_id, distance_km),
    FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_activities_time  ON activities(start_time);
CREATE INDEX idx_trackpoints_act  ON trackpoints(activity_id);
