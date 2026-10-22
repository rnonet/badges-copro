<?php
declare(strict_types=1);

/**
 * Envoi d'emails texte : SMTP (SSL ou STARTTLS, AUTH LOGIN), mail() de PHP, ou journal local pour les tests.
 */
final class Mailer
{
    /** Dernière erreur d'envoi (affichée par la page de diagnostic) */
    public static string $lastError = '';

    public static function send(string $to, string $subject, string $body): bool
    {
        $transport = config('mail_transport') ?: 'smtp';
        $from = config('mail_from');
        $fromName = config('mail_from_name') ?: '';

        if ($transport === 'log') {
            $line = sprintf("[%s] To: %s | %s\n%s\n---\n", now(), $to, $subject, $body);
            return file_put_contents(dirname(config('db_path')) . '/mail.log', $line, FILE_APPEND) !== false;
        }

        $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $encFrom = $fromName !== '' ? '=?UTF-8?B?' . base64_encode($fromName) . "?= <$from>" : $from;
        $headers = [
            'From' => $encFrom,
            'MIME-Version' => '1.0',
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Content-Transfer-Encoding' => '8bit',
        ];

        if ($transport === 'mail') {
            $h = '';
            foreach ($headers as $k => $v) {
                $h .= "$k: $v\r\n";
            }
            return mail($to, $encSubject, $body, $h, '-f' . $from);
        }

        try {
            self::smtp($to, $encSubject, $body, $headers);
            return true;
        } catch (Throwable $e) {
            self::$lastError = $e->getMessage();
            error_log('SMTP: ' . $e->getMessage());
            return false;
        }
    }

    private static function smtp(string $to, string $subject, string $body, array $headers): void
    {
        $c = config('smtp');
        $host = $c['host'];
        $port = (int) $c['port'];
        $enc = $c['encryption'] ?? '';
        $timeout = (int) ($c['timeout'] ?? 15);
        $remote = ($enc === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host]]);
        $fp = @stream_socket_client($remote, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new RuntimeException("Connexion impossible : $errstr ($errno)");
        }
        stream_set_timeout($fp, $timeout);

        $read = function () use ($fp): string {
            $data = '';
            while (($line = fgets($fp, 515)) !== false) {
                $data .= $line;
                if (isset($line[3]) && $line[3] === ' ') {
                    break;
                }
            }
            return $data;
        };
        $cmd = function (?string $line, array $expect) use ($fp, $read): string {
            if ($line !== null) {
                fwrite($fp, $line . "\r\n");
            }
            $resp = $read();
            $code = (int) substr($resp, 0, 3);
            if (!in_array($code, $expect, true)) {
                throw new RuntimeException('Réponse SMTP inattendue : ' . trim($resp));
            }
            return $resp;
        };

        $local = gethostname() ?: 'localhost';
        $cmd(null, [220]);
        $cmd("EHLO $local", [250]);
        if ($enc === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new RuntimeException('Échec STARTTLS');
            }
            $cmd("EHLO $local", [250]);
        }
        if (!empty($c['username'])) {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode($c['username']), [334]);
            $cmd(base64_encode($c['password']), [235]);
        }
        $from = config('mail_from');
        $cmd("MAIL FROM:<$from>", [250]);
        $cmd("RCPT TO:<$to>", [250, 251]);
        $cmd('DATA', [354]);

        $msg = '';
        $headers['To'] = $to;
        $headers['Subject'] = $subject;
        $headers['Date'] = date('r');
        $headers['Message-ID'] = '<' . bin2hex(random_bytes(12)) . '@' . substr(strrchr($from, '@'), 1) . '>';
        foreach ($headers as $k => $v) {
            $msg .= "$k: $v\r\n";
        }
        $body = preg_replace("/\r?\n/", "\r\n", $body);
        $body = preg_replace('/^\./m', '..', $body); // dot-stuffing
        $msg .= "\r\n" . $body . "\r\n.";
        $cmd($msg, [250]);
        $cmd('QUIT', [221]);
        fclose($fp);
    }
}
