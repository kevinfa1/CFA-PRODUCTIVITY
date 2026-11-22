<?php
/**
 * CFA Productivity — Mini Backend PHP Autónomo para Hosting Compartido (cPanel / Hostinger / GoDaddy)
 * Guarda trabajadores, registros de asistencia y fotos grupales en la carpeta ./storage/
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$STORAGE_DIR = __DIR__ . '/storage';
$PHOTOS_DIR  = $STORAGE_DIR . '/fotos';

if (!is_dir($STORAGE_DIR)) {
    @mkdir($STORAGE_DIR, 0755, true);
}
if (!is_dir($PHOTOS_DIR)) {
    @mkdir($PHOTOS_DIR, 0755, true);
}

// Proteger carpeta storage/ contra lectura directa de JSON desde el navegador
$htaccessPath = $STORAGE_DIR . '/.htaccess';
if (!file_exists($htaccessPath)) {
    @file_put_contents($htaccessPath, "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
}

$WORKERS_FILE    = $STORAGE_DIR . '/workers.json';
$ATTENDANCE_FILE = $STORAGE_DIR . '/attendance.json';

function json_out($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function default_projects(): array {
    return [
        [
            'id' => 1,
            'name' => 'Casa Las Flores',
            'location' => 'Casa Las Flores',
            'geofence_lat' => 14.6349,
            'geofence_lng' => -90.5069,
            'geofence_radius_m' => 100.0,
            'north_offset_deg' => 0.0,
            'floorplan_svg' => '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"></svg>',
        ],
        [
            'id' => 2,
            'name' => 'Pia Pia',
            'location' => 'Pia Pia',
            'geofence_lat' => 14.6349,
            'geofence_lng' => -90.5069,
            'geofence_radius_m' => 100.0,
            'north_offset_deg' => 0.0,
            'floorplan_svg' => '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"></svg>',
        ],
    ];
}

function load_crews(string $file): array {
    if (file_exists($file)) {
        $data = json_decode((string)file_get_contents($file), true);
        if (is_array($data)) return $data;
    }
    $initial = [
        [
            'id' => 1,
            'project_id' => 1,
            'name' => 'Planilla Casa Las Flores',
            'trade' => 'mamposteria',
            'workers' => [
                ['id' => 1, 'crew_id' => 1, 'name' => 'Moises Mendoza', 'role' => 'Albañil', 'active' => true],
                ['id' => 2, 'crew_id' => 1, 'name' => 'Maycol Lara', 'role' => 'Albañil', 'active' => true],
                ['id' => 3, 'crew_id' => 1, 'name' => 'Mario Blass', 'role' => 'Albañil', 'active' => true],
                ['id' => 4, 'crew_id' => 1, 'name' => 'Jose Alexander Alegria', 'role' => 'Albañil', 'active' => true],
                ['id' => 5, 'crew_id' => 1, 'name' => 'Celestino', 'role' => 'Albañil', 'active' => true],
                ['id' => 6, 'crew_id' => 1, 'name' => 'Pablo Blass', 'role' => 'Ayudante', 'active' => true],
                ['id' => 7, 'crew_id' => 1, 'name' => 'Alberto Dormez', 'role' => 'Ayudante', 'active' => true],
                ['id' => 8, 'crew_id' => 1, 'name' => 'Uriel Hernandez', 'role' => 'Ayudante', 'active' => true],
                ['id' => 9, 'crew_id' => 1, 'name' => 'Nervin Hernandez', 'role' => 'Ayudante', 'active' => true],
                ['id' => 10, 'crew_id' => 1, 'name' => 'Daniel Espinoza', 'role' => 'Ayudante', 'active' => true],
                ['id' => 11, 'crew_id' => 1, 'name' => 'Fernando Jose Sandino', 'role' => 'Ayudante', 'active' => true],
                ['id' => 12, 'crew_id' => 1, 'name' => 'Simon Bonilla', 'role' => 'Ayudante', 'active' => true],
                ['id' => 13, 'crew_id' => 1, 'name' => 'Edwin Jimenez', 'role' => 'Ayudante', 'active' => true],
                ['id' => 14, 'crew_id' => 1, 'name' => 'Cristhian Espinoza', 'role' => 'Ayudante', 'active' => true],
            ],
        ],
        [
            'id' => 2,
            'project_id' => 2,
            'name' => 'Planilla Pia Pia',
            'trade' => 'mamposteria',
            'workers' => [
                ['id' => 101, 'crew_id' => 2, 'name' => 'Manuel Reyes', 'role' => 'Albañil', 'active' => true],
                ['id' => 102, 'crew_id' => 2, 'name' => 'Jose Alcides Noguera', 'role' => 'Albañil', 'active' => true],
                ['id' => 103, 'crew_id' => 2, 'name' => 'Gabriel Mena', 'role' => 'Albañil', 'active' => true],
            ],
        ],
    ];
    @file_put_contents($file, json_encode($initial, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    return $initial;
}

function load_attendance(string $file): array {
    if (!file_exists($file)) return [];
    $data = json_decode((string)file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function normalize_role(string $role): ?string {
    $clean = mb_strtolower(trim($role), 'UTF-8');
    if ($clean === 'albañil' || $clean === 'albanil') return 'Albañil';
    if ($clean === 'ayudante') return 'Ayudante';
    return null;
}

$action = (string)($_GET['action'] ?? 'health');

if ($action === 'health') {
    json_out(['ok' => true, 'mode' => 'php', 'service' => 'cfa-hosting-php']);
}

if ($action === 'login') {
    $body = read_json_body();
    $user = mb_strtolower(trim((string)($body['username'] ?? '')), 'UTF-8');
    $pass = (string)($body['password'] ?? '');

    $accounts = [
        'moises' => ['username' => 'Moises', 'password' => 'flores2026', 'display_name' => 'Moisés (Maestro de Obra)', 'role' => 'maestro'],
        'kevin'  => ['username' => 'kevin',  'password' => 'kevin2026',  'display_name' => 'Kevin', 'role' => 'admin'],
        'norman' => ['username' => 'norman', 'password' => 'norman2026', 'display_name' => 'Norman', 'role' => 'admin'],
    ];

    if (!isset($accounts[$user]) || !hash_equals($accounts[$user]['password'], $pass)) {
        json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos'], 401);
    }

    $acc = $accounts[$user];
    json_out([
        'ok' => true,
        'token' => bin2hex(random_bytes(16)),
        'username' => $acc['username'],
        'display_name' => $acc['display_name'],
        'role' => $acc['role'],
        'allowed_tabs' => ['attendance'],
    ]);
}

if ($action === 'projects') {
    json_out(default_projects());
}

if ($action === 'crews') {
    $pid = (int)($_GET['project_id'] ?? 1);
    $all = load_crews($WORKERS_FILE);
    $filtered = array_values(array_filter($all, function ($c) use ($pid) {
        return (int)$c['project_id'] === $pid;
    }));
    json_out($filtered);
}

if ($action === 'add_worker') {
    $body = read_json_body();
    $crewId = (int)($body['crew_id'] ?? 1);
    $name = trim((string)($body['name'] ?? ''));
    $role = normalize_role((string)($body['role'] ?? ''));

    if ($name === '' || $role === null) {
        json_out(['ok' => false, 'error' => 'Nombre requerido y cargo debe ser Albañil o Ayudante'], 422);
    }

    $all = load_crews($WORKERS_FILE);
    $newWorker = ['id' => (int)(microtime(true) * 1000), 'crew_id' => $crewId, 'name' => $name, 'role' => $role, 'active' => true];
    foreach ($all as &$crew) {
        if ((int)$crew['id'] === $crewId) {
            $crew['workers'][] = $newWorker;
        }
    }
    unset($crew);
    @file_put_contents($WORKERS_FILE, json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    json_out($newWorker);
}

if ($action === 'attendance') {
    $pid = (int)($_GET['project_id'] ?? 1);
    $logs = load_attendance($ATTENDANCE_FILE);
    $filtered = array_values(array_filter($logs, function ($l) use ($pid) {
        return (int)$l['project_id'] === $pid;
    }));
    json_out($filtered);
}

if ($action === 'save_attendance') {
    $body = read_json_body();
    $pid = (int)($body['project_id'] ?? 1);
    $crewId = (int)($body['crew_id'] ?? 1);
    $workDate = trim((string)($body['work_date'] ?? date('Y-m-d')));
    $entries = is_array($body['entries'] ?? null) ? $body['entries'] : [];

    $logs = load_attendance($ATTENDANCE_FILE);
    $prevPhoto = null;
    $remaining = [];
    foreach ($logs as $l) {
        if ((int)$l['project_id'] === $pid && (string)$l['work_date'] === $workDate) {
            $prevPhoto = $l['group_photo_path'] ?? null;
        } else {
            $remaining[] = $l;
        }
    }

    $photoPath = $prevPhoto;
    $photoB64 = (string)($body['photo_base64'] ?? '');
    if ($photoB64 !== '') {
        $bin = base64_decode($photoB64, true);
        if ($bin !== false) {
            $fname = sprintf('p%d_%s_%s.jpg', $pid, preg_replace('/[^0-9\-]/', '', $workDate), bin2hex(random_bytes(4)));
            @file_put_contents($PHOTOS_DIR . '/' . $fname, $bin);
            $photoPath = './api.php?action=photo&file=' . rawurlencode($fname);
        }
    }

    $presentCount = 0;
    $totalHH = 0.0;
    $cleanEntries = [];
    foreach ($entries as $e) {
        $role = normalize_role((string)($e['role'] ?? '')) ?? 'Albañil';
        $status = (string)($e['status'] ?? 'ausente');
        $nh = (float)($e['normal_hours'] ?? 0);
        $eh = (float)($e['extra_hours'] ?? 0);
        if ($status !== 'ausente') {
            $presentCount++;
            $totalHH += ($nh + $eh);
        }
        $cleanEntries[] = [
            'worker_id' => $e['worker_id'] ?? null,
            'worker_name' => (string)($e['worker_name'] ?? ''),
            'role' => $role,
            'status' => $status,
            'normal_hours' => $nh,
            'extra_hours' => $eh,
            'reason' => (string)($e['reason'] ?? ''),
        ];
    }

    $newLog = [
        'id' => (int)(microtime(true) * 1000),
        'project_id' => $pid,
        'crew_id' => $crewId,
        'work_date' => $workDate,
        'registered_by' => (string)($body['registered_by'] ?? ''),
        'present_count' => $presentCount,
        'total_workers' => count($cleanEntries),
        'total_hh' => round($totalHH, 2),
        'inside_geofence' => $body['inside_geofence'] ?? null,
        'distance_m' => $body['distance_m'] ?? null,
        'group_photo_path' => $photoPath,
        'entries' => $cleanEntries,
    ];

    array_unshift($remaining, $newLog);
    @file_put_contents($ATTENDANCE_FILE, json_encode($remaining, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    json_out($newLog);
}

if ($action === 'photo') {
    $file = basename((string)($_GET['file'] ?? ''));
    $full = $PHOTOS_DIR . '/' . $file;
    if ($file === '' || !file_exists($full)) {
        http_response_code(404);
        exit('Foto no encontrada');
    }
    header('Content-Type: image/jpeg');
    header('Cache-Control: public, max-age=86400');
    readfile($full);
    exit;
}

if ($action === 'export_csv') {
    $pid = (int)($_GET['project_id'] ?? 1);
    $projects = default_projects();
    $projName = 'Proyecto_' . $pid;
    foreach ($projects as $p) {
        if ((int)$p['id'] === $pid) $projName = $p['name'];
    }

    $logs = load_attendance($ATTENDANCE_FILE);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="cfa_asistencia_' . preg_replace('/\s+/', '_', strtolower($projName)) . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['fecha', 'proyecto', 'registrado_por', 'trabajador', 'cargo', 'estado', 'horas_normales', 'horas_extra', 'total_hh', 'motivo_ausencia', 'en_obra_100m', 'distancia_m']);
    foreach ($logs as $log) {
        if ((int)$log['project_id'] !== $pid) continue;
        $geo = $log['inside_geofence'] === true ? 'SI' : ($log['inside_geofence'] === false ? 'NO' : 'N/A');
        $dist = $log['distance_m'] !== null ? round((float)$log['distance_m'], 1) : '';
        foreach ($log['entries'] as $e) {
            $hh = $e['status'] === 'ausente' ? 0 : round((float)$e['normal_hours'] + (float)$e['extra_hours'], 2);
            fputcsv($out, [
                $log['work_date'],
                $projName,
                $log['registered_by'] ?? '',
                $e['worker_name'],
                $e['role'],
                $e['status'],
                $e['normal_hours'],
                $e['extra_hours'],
                $hh,
                $e['reason'],
                $geo,
                $dist,
            ]);
        }
    }
    fclose($out);
    exit;
}

json_out(['ok' => false, 'error' => 'Acción no válida'], 400);
