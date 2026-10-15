<?php
declare(strict_types=1);

/**
 * Lecture du numéro de série d'un badge sur photo, via l'API Anthropic (Claude).
 * La photo n'est jamais écrite sur disque : elle transite en mémoire puis est oubliée.
 */
final class Ocr
{
    private const PROMPT = <<<TXT
Cette photo montre un badge d'accès d'immeuble (badge Vigik, porte-clés RFID ou carte).
Repère le numéro de série imprimé ou gravé dessus. C'est une suite de caractères hexadécimaux (chiffres 0-9 et lettres A-F), souvent de 6 à 16 caractères, parfois découpée par des espaces ou des tirets.
Ignore les marques, logos, numéros de téléphone, dates et mots ordinaires.
Attention aux confusions : O → 0, I ou l → 1, S → 5, B peut être 8 ; ne garde que des caractères 0-9 A-F.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"serial": "<numéro le plus probable, sans espaces, en majuscules, ou chaîne vide>", "candidates": ["<autres suites hexadécimales visibles>"], "confidence": "high" | "medium" | "low"}
Si aucun numéro n'est lisible, renvoie {"serial": "", "candidates": [], "confidence": "low"}.
TXT;

    public static function enabled(): bool
    {
        return trim((string) config('anthropic_api_key')) !== '';
    }

    /**
     * @param string $jpegBytes image JPEG (ou PNG/WebP) brute
     * @return array{serial:string,candidates:string[],confidence:string}
     */
    public static function read(string $imageBytes, string $mediaType): array
    {
        $payload = [
            'model'      => config('anthropic_model') ?: 'claude-haiku-5-5',
            'max_tokens' => 300,
            'messages'   => [[
                'role'    => 'user',
                'content' => [
                    ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mediaType, 'data' => base64_encode($imageBytes)]],
                    ['type' => 'text', 'text' => self::PROMPT],
                ],
            ]],
        ];
        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => [
                'content-type: application/json',
                'anthropic-version: 2023-06-01',
                'x-api-key: ' . config('anthropic_api_key'),
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload),
        ]);
        $resp = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        unset($payload, $imageBytes);

        if ($resp === false || $status >= 400) {
            error_log("OCR Anthropic: HTTP $status $err " . substr((string) $resp, 0, 300));
            throw new RuntimeException('Le service de lecture est indisponible.');
        }
        $data = json_decode($resp, true);
        $text = '';
        foreach ($data['content'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'text') {
                $text .= $block['text'];
            }
        }
        return self::parse($text);
    }

    /** Extrait et nettoie le JSON renvoyé par le modèle */
    public static function parse(string $text): array
    {
        $result = ['serial' => '', 'candidates' => [], 'confidence' => 'low'];
        if (!preg_match('/\{.*\}/s', $text, $m)) {
            return $result;
        }
        $json = json_decode($m[0], true);
        if (!is_array($json)) {
            return $result;
        }
        $clean = function ($s): string {
            $s = normalize_serial((string) $s);
            return serial_error($s) === null ? $s : '';
        };
        $serial = $clean($json['serial'] ?? '');
        $cands = [];
        foreach ((array) ($json['candidates'] ?? []) as $c) {
            $c = $clean($c);
            if ($c !== '' && $c !== $serial && !in_array($c, $cands, true)) {
                $cands[] = $c;
            }
        }
        if ($serial === '' && $cands) {
            $serial = array_shift($cands);
        }
        $conf = in_array($json['confidence'] ?? '', ['high', 'medium', 'low'], true) ? $json['confidence'] : 'low';
        return ['serial' => $serial, 'candidates' => array_slice($cands, 0, 4), 'confidence' => $serial === '' ? 'low' : $conf];
    }
}
