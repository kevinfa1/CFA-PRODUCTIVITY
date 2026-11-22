<?php
/**
 * CFA Productivity — Panel Web de Oficina (Planilla y Galería de Fotos)
 * Muestra en vivo los registros guardados en ./storage/attendance.json y ./storage/fotos/
 */

declare(strict_types=1);
session_start();

$STORAGE_DIR     = __DIR__ . '/storage';
$ATTENDANCE_FILE = $STORAGE_DIR . '/attendance.json';

$ACCOUNTS = [
    'kevin'  => ['username' => 'kevin',  'password' => 'kevin2026',  'display' => 'Kevin'],
    'norman' => ['username' => 'norman', 'password' => 'norman2026', 'display' => 'Norman'],
    'moises' => ['username' => 'Moises', 'password' => 'flores2026', 'display' => 'Moisés'],
];

if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: panel.php');
    exit;
}

$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['username'], $_POST['password'])) {
    $u = mb_strtolower(trim((string)$_POST['username']), 'UTF-8');
    $p = (string)$_POST['password'];
    if (isset($ACCOUNTS[$u]) && hash_equals($ACCOUNTS[$u]['password'], $p)) {
        $_SESSION['cfa_panel_user'] = $ACCOUNTS[$u];
        header('Location: panel.php');
        exit;
    }
    $loginError = 'Usuario o contraseña incorrectos.';
}

$user = $_SESSION['cfa_panel_user'] ?? null;

$projectsMap = [
    1 => 'Casa Las Flores',
    2 => 'Pia Pia',
];

$logs = [];
if ($user && file_exists($ATTENDANCE_FILE)) {
    $decoded = json_decode((string)file_get_contents($ATTENDANCE_FILE), true);
    if (is_array($decoded)) $logs = $decoded;
}

$filterProj = (string)($_GET['project_id'] ?? 'all');
$filterDate = (string)($_GET['work_date'] ?? '');

$filteredLogs = array_values(array_filter($logs, function ($l) use ($filterProj, $filterDate) {
    if ($filterProj !== 'all' && (string)($l['project_id'] ?? '') !== $filterProj) return false;
    if ($filterDate !== '' && (string)($l['work_date'] ?? '') !== $filterDate) return false;
    return true;
}));

function h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CFA — Panel de Planilla y Fotos</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background: #edf1f5; color: #0f172a; padding: 16px; }
    .wrap { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .topbar { background: #0b1f3a; color: #fff; border-bottom: 4px solid #f59e0b; border-radius: 14px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .topbar h1 { font-size: 20px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px; border: 2px solid #0b1f3a; background: #fff; color: #0b1f3a; font-weight: 700; font-size: 14px; text-decoration: none; cursor: pointer; }
    .btn.pri { background: #0b1f3a; color: #fff; }
    .btn.amb { background: #f59e0b; border-color: #f59e0b; color: #0b1f3a; }
    .card { background: #fff; border: 2px solid #94a3b8; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    select, input[type="date"], input[type="text"], input[type="password"] { padding: 10px 12px; border: 2px solid #0b1f3a; border-radius: 10px; font-size: 15px; font-weight: 600; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 8px; border-bottom: 1.5px solid #cbd5e1; text-align: left; vertical-align: middle; }
    th { background: #f8fafc; font-size: 12px; text-transform: uppercase; color: #334155; }
    .thumb { width: 72px; height: 52px; object-fit: cover; border-radius: 8px; border: 2px solid #0b1f3a; display: block; }
    .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .badge.ok { background: #dcfce7; color: #14532d; }
    .badge.warn { background: #fee2e2; color: #7f1d1d; }
    .badge.alb { background: #dbeafe; color: #1e3a8a; }
    .badge.ayu { background: #fef3c7; color: #92400e; }
    .login-box { max-width: 400px; margin: 48px auto; background: #fff; border: 2.5px solid #0b1f3a; border-radius: 16px; overflow: hidden; }
    .login-head { background: #0b1f3a; color: #fff; padding: 20px; border-bottom: 4px solid #f59e0b; }
    .login-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  </style>
</head>
<body>
<?php if (!$user): ?>
  <form class="login-box" method="post">
    <div class="login-head">
      <div style="font-size:12px;color:#fde68a;font-weight:700;letter-spacing:1px">CFA · OFICINA</div>
      <h1 style="font-size:21px;margin-top:4px">Panel de Planilla y Fotos</h1>
    </div>
    <div class="login-body">
      <?php if ($loginError): ?>
        <div style="background:#fee2e2;border:2px solid #b91c1c;color:#7f1d1d;padding:10px;border-radius:10px;font-weight:700"><?= h($loginError) ?></div>
      <?php endif; ?>
      <label style="font-weight:700">Usuario</label>
      <input type="text" name="username" required placeholder="kevin o norman" />
      <label style="font-weight:700">Contraseña</label>
      <input type="password" name="password" required />
      <button type="submit" class="btn pri" style="justify-content:center;padding:12px">Entrar al Panel</button>
    </div>
  </form>
<?php else: ?>
  <div class="wrap">
    <header class="topbar">
      <div>
        <div style="font-size:11px;color:#fde68a;font-weight:700">CFA · OFICINA EN TU HOSTING</div>
        <h1>Planilla de Asistencias y Fotos</h1>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn amb" href="./api.php?action=export_csv&project_id=1">CSV Casa Las Flores</a>
        <a class="btn amb" href="./api.php?action=export_csv&project_id=2">CSV Pia Pia</a>
        <a class="btn" href="./">Ir a App Móvil</a>
        <a class="btn" href="panel.php?logout=1">Salir (<?= h($user['username']) ?>)</a>
      </div>
    </header>

    <section class="card">
      <form class="filters" method="get">
        <select name="project_id" onchange="this.form.submit()">
          <option value="all" <?= $filterProj === 'all' ? 'selected' : '' ?>>Todas las obras</option>
          <option value="1" <?= $filterProj === '1' ? 'selected' : '' ?>>Casa Las Flores</option>
          <option value="2" <?= $filterProj === '2' ? 'selected' : '' ?>>Pia Pia</option>
        </select>
        <input type="date" name="work_date" value="<?= h($filterDate) ?>" onchange="this.form.submit()" />
        <?php if ($filterProj !== 'all' || $filterDate !== ''): ?>
          <a class="btn" href="panel.php">Limpiar filtros</a>
        <?php endif; ?>
      </form>
    </section>

    <section class="card" style="overflow-x:auto">
      <h2 style="font-size:16px">Resumen Diario (<?= count($filteredLogs) ?> registros)</h2>
      <?php if (count($filteredLogs) === 0): ?>
        <p style="color:#475569;font-weight:600">Aún no hay asistencias registradas con estos filtros.</p>
      <?php else: ?>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Obra</th>
              <th>Registrado por</th>
              <th>Presentes</th>
              <th>Total HH</th>
              <th>GPS (100m)</th>
              <th>Foto Grupal</th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($filteredLogs as $log):
              $pid = (int)($log['project_id'] ?? 1);
              $pName = $projectsMap[$pid] ?? ('Proyecto #' . $pid);
              $geo = $log['inside_geofence'] ?? null;
              $dist = $log['distance_m'] ?? null;
              $photo = (string)($log['group_photo_path'] ?? '');
            ?>
              <tr>
                <td><strong><?= h((string)$log['work_date']) ?></strong></td>
                <td><strong><?= h($pName) ?></strong></td>
                <td><?= h((string)($log['registered_by'] ?? '—')) ?></td>
                <td><?= (int)$log['present_count'] ?> / <?= (int)$log['total_workers'] ?></td>
                <td><strong><?= number_format((float)$log['total_hh'], 1) ?> HH</strong></td>
                <td>
                  <?php if ($geo === true): ?>
                    <span class="badge ok">En obra (<?= (int)$dist ?> m)</span>
                  <?php elseif ($geo === false): ?>
                    <span class="badge warn">Fuera (<?= (int)$dist ?> m)</span>
                  <?php else: ?>
                    <span>N/A</span>
                  <?php endif; ?>
                </td>
                <td>
                  <?php if ($photo !== ''): ?>
                    <a href="<?= h($photo) ?>" target="_blank" title="Abrir foto en grande">
                      <img class="thumb" src="<?= h($photo) ?>" alt="Foto grupal" />
                    </a>
                  <?php else: ?>
                    <span style="color:#64748b">Sin foto</span>
                  <?php endif; ?>
                </td>
              </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      <?php endif; ?>
    </section>

    <?php if (count($filteredLogs) > 0): ?>
      <section class="card" style="overflow-x:auto">
        <h2 style="font-size:16px">Detalle por Trabajador (Último filtro)</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Obra</th>
              <th>Trabajador</th>
              <th>Cargo</th>
              <th>Estado</th>
              <th>H. Normales</th>
              <th>H. Extra</th>
              <th>Total HH</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($filteredLogs as $log):
              $pid = (int)($log['project_id'] ?? 1);
              $pName = $projectsMap[$pid] ?? ('Proyecto #' . $pid);
              foreach (($log['entries'] ?? []) as $e):
                $st = (string)($e['status'] ?? 'ausente');
                $hh = $st === 'ausente' ? 0.0 : ((float)$e['normal_hours'] + (float)$e['extra_hours']);
                $role = (string)($e['role'] ?? 'Albañil');
            ?>
              <tr>
                <td><?= h((string)$log['work_date']) ?></td>
                <td><?= h($pName) ?></td>
                <td><strong><?= h((string)$e['worker_name']) ?></strong></td>
                <td><span class="badge <?= $role === 'Albañil' ? 'alb' : 'ayu' ?>"><?= h($role) ?></span></td>
                <td style="text-transform:capitalize;font-weight:700"><?= h($st) ?></td>
                <td><?= number_format((float)$e['normal_hours'], 1) ?></td>
                <td><?= number_format((float)$e['extra_hours'], 1) ?></td>
                <td><strong><?= number_format($hh, 1) ?></strong></td>
                <td><?= h((string)($e['reason'] ?? '')) ?></td>
              </tr>
            <?php endforeach; endforeach; ?>
          </tbody>
        </table>
      </section>
    <?php endif; ?>
  </div>
<?php endif; ?>
</body>
</html>
