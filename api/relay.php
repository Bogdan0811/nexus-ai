<?php
/* NEXUS AI · relay.php — связь «сцена ↔ телефон судьи» для показа.
   Только синтетические события демо (запрос «Близкие», ответ, статус). Без персональных данных.
   GET  ?ping=1                              → {"ok":true,"relay":1}
   GET  ?room=R&ch=phone|stage&since=N       → {"ok":true,"seq":M,"msgs":[{seq,t,data}]}
   POST ?room=R&ch=phone|stage   body: JSON  → {"ok":true,"seq":M}
   Хранение: файлы в relay-data/ (доступ к папке закрыт .htaccess), 50 последних сообщений, комната живёт 3 часа. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out($a, $code = 200) { http_response_code($code); echo json_encode($a, JSON_UNESCAPED_UNICODE); exit; }

if (isset($_GET['ping'])) out(['ok' => true, 'relay' => 1]);

$room = isset($_GET['room']) ? $_GET['room'] : '';
$ch = isset($_GET['ch']) ? $_GET['ch'] : '';
if (!preg_match('/^[a-z0-9]{6,24}$/', $room) || !in_array($ch, ['phone', 'stage'], true)) out(['ok' => false, 'error' => 'bad_request'], 400);

$dir = __DIR__ . '/relay-data';
if (!is_dir($dir)) { @mkdir($dir, 0750, true); @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n"); }
$file = $dir . '/' . $room . '-' . $ch . '.json';

// уборка старых комнат (раз в ~50 запросов)
if (mt_rand(1, 50) === 1) { foreach ((array)glob($dir . '/*.json') as $f) { if (@filemtime($f) < time() - 3 * 3600) @unlink($f); } }

function load($file) {
  if (!is_file($file)) return ['seq' => 0, 'msgs' => []];
  $j = json_decode((string)@file_get_contents($file), true);
  return is_array($j) && isset($j['seq']) ? $j : ['seq' => 0, 'msgs' => []];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $raw = file_get_contents('php://input', false, null, 0, 4097);
  if ($raw === false || strlen($raw) > 4096) out(['ok' => false, 'error' => 'too_large'], 413);
  $data = json_decode($raw, true);
  if (!is_array($data)) out(['ok' => false, 'error' => 'bad_json'], 400);
  $fp = fopen($file, 'c+');
  if (!$fp) out(['ok' => false, 'error' => 'storage'], 500);
  flock($fp, LOCK_EX);
  $cur = stream_get_contents($fp);
  $st = json_decode($cur ? $cur : '', true);
  if (!is_array($st) || !isset($st['seq'])) $st = ['seq' => 0, 'msgs' => []];
  $st['seq']++;
  $st['msgs'][] = ['seq' => $st['seq'], 't' => round(microtime(true) * 1000), 'data' => $data];
  if (count($st['msgs']) > 50) $st['msgs'] = array_slice($st['msgs'], -50);
  ftruncate($fp, 0); rewind($fp);
  fwrite($fp, json_encode($st, JSON_UNESCAPED_UNICODE));
  fflush($fp); flock($fp, LOCK_UN); fclose($fp);
  out(['ok' => true, 'seq' => $st['seq']]);
}

$since = isset($_GET['since']) ? (int)$_GET['since'] : 0;
$st = load($file);
$msgs = array_values(array_filter($st['msgs'], function ($m) use ($since) { return $m['seq'] > $since; }));
out(['ok' => true, 'seq' => $st['seq'], 'msgs' => $msgs]);
