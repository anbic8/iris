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
    resting_hr        INT           DEFAULT NULL,
    gender            ENUM('male','female') DEFAULT 'male',
    strength_enabled  BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT          NOT NULL,
    sport_type       ENUM('running','cycling','hiking','other','trail') NOT NULL DEFAULT 'other',
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

CREATE TABLE IF NOT EXISTS lactate_tests (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    test_date   DATE         NOT NULL,
    lt_pace     DECIMAL(6,3) DEFAULT NULL,
    lt_hr       INT          DEFAULT NULL,
    ias_pace    DECIMAL(6,3) DEFAULT NULL,
    ias_hr      INT          DEFAULT NULL,
    vo2max      DECIMAL(5,1) DEFAULT NULL,
    notes       TEXT         DEFAULT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lactate_stages (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    test_id     INT          NOT NULL,
    stage_nr    INT          NOT NULL,
    speed_kmh   DECIMAL(4,1) NOT NULL,
    hr          INT          DEFAULT NULL,
    lactate     DECIMAL(4,2) DEFAULT NULL,
    FOREIGN KEY (test_id) REFERENCES lactate_tests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exercises (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          DEFAULT NULL,
    name        VARCHAR(100) NOT NULL,
    category    VARCHAR(50)  DEFAULT NULL,
    muscles     VARCHAR(200) DEFAULT NULL,
    is_global   BOOLEAN      NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_templates (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_template_exercises (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT          NOT NULL,
    exercise_id INT          NOT NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)         ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sessions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT          NOT NULL,
    template_id   INT          DEFAULT NULL,
    session_date  DATE         NOT NULL,
    duration_min  INT          DEFAULT NULL,
    notes         TEXT         DEFAULT NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)     REFERENCES users(id)               ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES workout_templates(id)   ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workout_sets (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    session_id   INT          NOT NULL,
    exercise_id  INT          NOT NULL,
    set_nr       INT          NOT NULL,
    reps         INT          DEFAULT NULL,
    weight_kg    DECIMAL(5,2) DEFAULT NULL,
    duration_s   INT          DEFAULT NULL,
    FOREIGN KEY (session_id)  REFERENCES workout_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)        ON DELETE CASCADE
);

-- Global exercise presets
INSERT IGNORE INTO exercises (user_id, name, category, muscles, is_global) VALUES
(NULL,'Kniebeuge','Beine','Quadrizeps, Gesäß, Rückenstrecker',1),
(NULL,'Kreuzheben','Rücken','Rückenstrecker, Gesäß, Hamstrings',1),
(NULL,'Bankdrücken','Brust','Pectoralis, Trizeps, Schulter',1),
(NULL,'Klimmzüge','Rücken','Latissimus, Bizeps, Trapez',1),
(NULL,'Schulterdrücken','Schulter','Deltoideus, Trizeps',1),
(NULL,'Rudern (Langhantel)','Rücken','Latissimus, Rhomboid, Bizeps',1),
(NULL,'Dips','Brust/Trizeps','Trizeps, Pectoralis',1),
(NULL,'Bizepscurl','Arme','Bizeps',1),
(NULL,'Trizepsstrecken','Arme','Trizeps',1),
(NULL,'Beinpresse','Beine','Quadrizeps, Gesäß',1),
(NULL,'Ausfallschritte','Beine','Quadrizeps, Gesäß, Hamstrings',1),
(NULL,'Hip Thrust','Gesäß','Gluteus Maximus',1),
(NULL,'Lat-Zug','Rücken','Latissimus, Bizeps',1),
(NULL,'Facepull','Schulter','Hintere Schulter, Trapez',1),
(NULL,'Arnold Press','Schulter','Deltoideus, Trizeps',1),
(NULL,'Romanian Deadlift','Beine','Hamstrings, Gesäß',1),
(NULL,'Bulgarian Split Squat','Beine','Quadrizeps, Gesäß',1),
(NULL,'Beinbeuger','Beine','Hamstrings',1),
(NULL,'Wadenheben','Beine','Wadenmuskulatur',1),
(NULL,'Plank','Core','Bauch, Rumpfstabilisatoren',1),
(NULL,'Sit-ups','Core','Rectus Abdominis',1),
(NULL,'Russian Twist','Core','Obliques',1),
(NULL,'Hyperextensions','Rücken','Rückenstrecker',1),
(NULL,'Seitheben','Schulter','Seitlicher Deltoideus',1),
(NULL,'Vorgebeugtes Seitheben','Schulter','Hintere Schulter',1),
(NULL,'Hammer Curl','Arme','Bizeps, Brachialis',1),
(NULL,'Trizeps Pushdown','Arme','Trizeps',1),
(NULL,'Rudern (Kabelzug)','Rücken','Latissimus, Rhomboid',1),
(NULL,'Schrägbankdrücken','Brust','Oberer Pectoralis',1),
(NULL,'Butterfly','Brust','Pectoralis',1),
(NULL,'Beinstrecker','Beine','Quadrizeps',1);

CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_activities_time  ON activities(start_time);
CREATE INDEX idx_trackpoints_act  ON trackpoints(activity_id);
CREATE INDEX idx_lactate_user     ON lactate_tests(user_id);
CREATE INDEX idx_wsessions_user   ON workout_sessions(user_id);
