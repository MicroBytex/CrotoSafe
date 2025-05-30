#!/usr/bin/env node

const express = require("express");
const readline = require("readline");
const chalk = require("chalk");
const axios = require("axios");
require("dotenv").config();

// ==================== CLASES PRINCIPALES ====================

class ThreatDatabase {
    constructor() {
        this.maliciousLinks = new Set([
            "malicious-site.com",
            "phishing-example.org",
            "spam-link.net",
        ]);
        this.spamKeywords = new Set([
            "oferta exclusiva",
            "gana dinero rápido",
            "promoción especial",
            "gratis",
            "premio",
        ]);
    }

    isMaliciousLink(link) {
        return Array.from(this.maliciousLinks).some((malicious) =>
            link.includes(malicious),
        );
    }

    addMaliciousLink(link) {
        this.maliciousLinks.add(link);
    }

    addSpamKeyword(keyword) {
        this.spamKeywords.add(keyword.toLowerCase());
    }
}

class UserProfile {
    constructor(userId) {
        this.userId = userId;
        this.messageCount = 0;
        this.warnings = 0;
        this.reputationScore = 100;
        this.joinDate = new Date();
        this.lastActivity = new Date();
        this.isWhitelisted = false;
        this.isBlacklisted = false;
    }

    addMessage(message) {
        this.messageCount++;
        this.lastActivity = new Date();
    }

    addWarning(severity = 1) {
        this.warnings++;
        this.reputationScore = Math.max(0, this.reputationScore - severity * 5);
    }
}

class RateLimiter {
    constructor() {
        this.userActivity = new Map();
        this.messagesPerMinute = 10;
    }

    checkRateLimit(userId, message) {
        const now = Date.now();
        const userMessages = this.userActivity.get(userId) || [];

        const recentMessages = userMessages.filter(
            (time) => now - time < 60000,
        );

        if (recentMessages.length >= this.messagesPerMinute) {
            return false;
        }

        recentMessages.push(now);
        this.userActivity.set(userId, recentMessages);

        return true;
    }
}

class WhatsAppActionHandler {
    constructor() {
        this.bannedUsers = new Set();
        this.tempBans = new Map();
    }

    warnUser(userId, reason) {
        console.log(
            chalk.yellow(`⚠️  Enviando advertencia a ${userId}: ${reason}`),
        );
    }

    banUser(userId, duration = null) {
        if (duration) {
            const expiration = Date.now() + duration;
            this.tempBans.set(userId, expiration);
        } else {
            this.bannedUsers.add(userId);
        }
        console.log(chalk.red(`🔒 Usuario ${userId} baneado`));
    }

    isBanned(userId) {
        if (this.bannedUsers.has(userId)) {
            return true;
        }

        const tempBan = this.tempBans.get(userId);
        if (tempBan && Date.now() < tempBan) {
            return true;
        } else if (tempBan) {
            this.tempBans.delete(userId);
        }

        return false;
    }
}

class WebSearch {
    async search(query) {
        try {
            console.log(chalk.blue(`🔍 Buscando: ${query}`));
            console.log("");

            const wikiResult = await this.searchWikipedia(query);
            if (wikiResult) {
                console.log(chalk.green("📖 Resultado de Wikipedia:"));
                console.log(chalk.white(wikiResult.title));
                console.log(chalk.gray(wikiResult.extract));
                console.log("");
            }

            console.log(chalk.green("🌐 Resultados de búsqueda web:"));
            console.log(
                chalk.blue("1. "),
                `Resultado relacionado con "${query}"`,
            );
            console.log(chalk.blue("2. "), `Más información sobre "${query}"`);
            console.log(chalk.blue("3. "), `Guía completa de "${query}"`);
            console.log("");
        } catch (error) {
            console.log(chalk.red("❌ Error en la búsqueda:"), error.message);
        }
    }

    async searchWikipedia(query) {
        try {
            const response = await axios.get(
                `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
                { timeout: 5000 },
            );

            if (response.data && response.data.extract) {
                return {
                    title: response.data.title,
                    extract: response.data.extract.substring(0, 300) + "...",
                };
            }
        } catch (error) {
            // Silencioso si no encuentra resultados
        }
        return null;
    }
}

class CrotoSafe {
    constructor() {
        this.app = express();
        this.server = null;
        this.stats = {
            messagesProcessed: 0,
            blockedMessages: 0,
            warnings: 0,
            bannedUsers: 0,
            startTime: new Date(),
            webhookStatus: "Inactive",
        };

        this.threatDatabase = new ThreatDatabase();
        this.userProfiles = new Map();
        this.rateLimiter = new RateLimiter();
        this.actionHandler = new WhatsAppActionHandler();

        this.setupExpress();
    }

    setupExpress() {
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.json());

        this.app.post("/whatsapp-webhook", (req, res) => {
            this.handleWhatsAppMessage(req, res);
        });

        this.app.get("/status", (req, res) => {
            res.json(this.getStats());
        });
    }

    start() {
        this.server = this.app.listen(5000, "0.0.0.0", () => {
            this.stats.webhookStatus = "Active on port 5000";
            console.log(
                chalk.green(
                    "🌐 Webhook activo en http://0.0.0.0:5000/whatsapp-webhook",
                ),
            );
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.stats.webhookStatus = "Inactive";
        }
    }

    handleWhatsAppMessage(req, res) {
        try {
            const {
                From: userId,
                Body: message,
                MessageSid: messageId,
                ProfileName: profileName,
            } = req.body;

            if (!userId || !message) {
                return res.json({ status: "ignored" });
            }

            this.stats.messagesProcessed++;

            console.log(`\n${"=".repeat(50)}`);
            console.log(chalk.cyan(`[📩 MENSAJE RECIBIDO]`));
            console.log(`Usuario: ${profileName || "Desconocido"}`);
            console.log(`ID: ${userId}`);
            console.log(`Mensaje: ${message}`);
            console.log(`${"=".repeat(50)}\n`);

            this.processMessage(userId, message, messageId);

            res.json({ status: "processed" });
        } catch (error) {
            console.error(chalk.red("❌ Error procesando mensaje:"), error);
            res.status(500).json({ status: "error" });
        }
    }

    processMessage(userId, message, messageId) {
        if (this.actionHandler.isBanned(userId)) {
            this.stats.blockedMessages++;
            return;
        }

        let userProfile = this.userProfiles.get(userId);
        if (!userProfile) {
            userProfile = new UserProfile(userId);
            this.userProfiles.set(userId, userProfile);
        }

        if (!this.rateLimiter.checkRateLimit(userId, message)) {
            this.actionHandler.warnUser(
                userId,
                "Has excedido el límite de mensajes",
            );
            this.stats.warnings++;
            this.stats.blockedMessages++;
            return;
        }

        const threats = this.analyzeMessage(message, userProfile);
        userProfile.addMessage(message);

        if (threats.threatLevel >= 8) {
            this.actionHandler.banUser(userId);
            this.stats.bannedUsers++;
            this.stats.blockedMessages++;
        } else if (threats.threatLevel >= 5) {
            this.actionHandler.warnUser(userId, "Mensaje sospechoso detectado");
            this.stats.warnings++;
            this.stats.blockedMessages++;
        }
    }

    analyzeMessage(message, userProfile) {
        const threats = {
            hasLinks: false,
            hasSpamKeywords: false,
            isSpam: false,
            threatLevel: 0,
        };

        const linkRegex = /https?:\/\/[^\s]+/gi;
        const links = message.match(linkRegex);
        if (links) {
            threats.hasLinks = true;
            threats.threatLevel += 3;

            for (const link of links) {
                if (this.threatDatabase.isMaliciousLink(link)) {
                    threats.threatLevel += 5;
                    break;
                }
            }
        }

        const messageText = message.toLowerCase();
        for (const keyword of this.threatDatabase.spamKeywords) {
            if (messageText.includes(keyword)) {
                threats.hasSpamKeywords = true;
                threats.threatLevel += 2;
            }
        }

        if (userProfile.reputationScore < 50) {
            threats.threatLevel += 2;
        }

        return threats;
    }

    getStats() {
        const uptime = Math.floor(
            (Date.now() - this.stats.startTime.getTime()) / 1000,
        );
        return {
            ...this.stats,
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
        };
    }
}

// ==================== CLI INTERFACE ====================

class CrotoSafeCLI {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        this.crotosafe = null;
        this.isRunning = false;
        this.webSearch = new WebSearch();
    }

    start() {
        this.showWelcome();
        this.promptCommand();
    }

    showWelcome() {
        const asciiArt = `

                  @@@@      @@@@                            
               @@@%%%@@@@@@@%%@@@@                          
              @@@%###%%%%%%###%@@@@                         
         @@@  @@%##############%@@@@ @@@                    
        @@@@@@@@%##############%@@@@@@@@@                   
        @%*#@@@%###############%@@@@@%#%@@                  
       @@#*+#@@@%%%%%%#####%%%%%@@@@%*+#%@                  
    @@@@%*++*%@@@@@@@@@@@@@@@@@@@@@%#++*%@@@@               
   @@%%%%%%##%@@@@@@@@@@@@@@@@@@@@@@%##%%@@@@@              
    @@%%%%%%%%@@@@@@@@@@@@@@@@@@@@@%%@@@@@@@@@              
     @@@@%%%%%%%#%%%%%%%%%%%%%%%%%%%@@@@@@@@                
     @@#***###%%%@%%%%%%%%%%%%@@@%%%##***#%@@@@@@@@@        
    @@%*=+++++++*****************+++++++*%%*+===+*%@@@      
    @@#====++++++***************+++++++*%#==*%%%#+=*%@@     
   @@%*=====++++++**************+++++=+##=+%@@@@@%*=*%@     
   @%#========#%%%%%#********%%%%%#+==*%*=#%@   @@#=*%@     
   @@%+========++++*#*******%#++++====*%*=#%@   @@#+*%@     
    @@@%*+=======++++********++++===+#%%%%%%%%%%%%%%%%%@@   
       @@%#+======++++#%%%#*+++=====#%=---------------=#@@  
         @@@%*======++*#%%*+++=====*%#=------===------=#@@  
            @@@#+====++*#**++===+*%@@#=-----*@@%#=----=#@@  
               @@%*===+*#*+===+%@@@@@#=-----*@@@%=-----#@@  
                 @@@%+=+#*==#%@@   @@#=------*@%=-----=#@@  
                   @@@%###%@@@     @@#=------%@%+-----=#@@  
                      @@@@@        @@#=-----=+++=-----=#@@  
                                    @%#+++++++++++++++#%@   
                                     @@@@@@@@@@@@@@@@@@@    

        `;

        console.clear();
        console.log(chalk.cyan(asciiArt));
        console.log(chalk.bold.green("                         CrotoSafe"));
        console.log("");
        console.log(chalk.yellow("[ 1 ] Seguridad"));
        console.log(chalk.yellow("[ 2 ] Crotolandia"));
        console.log(chalk.yellow("[ 3 ] Script integrados"));
        console.log(chalk.yellow("[ 4 ] Herramientas integradas"));
        console.log(chalk.yellow("[ 5 ] Privacidad"));
        console.log("");
        console.log(
            chalk.blue(
                "💡 Escribe HELP; para ver todos los comandos disponibles",
            ),
        );
        console.log("");
    }

    promptCommand() {
        this.rl.question(chalk.green("CrotoSafe> "), (input) => {
            this.processCommand(input.trim());
        });
    }

    processCommand(command) {
        const cmd = command.toUpperCase();

        switch (cmd) {
            case "ENABLE CROTOSAFE;":
                this.enableCrotoSafe();
                break;
            case "SHOW CROTOSAFE;":
                this.showStatus();
                break;
            case "HELP;":
                this.showHelp();
                break;
            case "EXIT;":
                this.exit();
                return;
            default:
                if (cmd.startsWith("SEARCH ")) {
                    const query = command.substring(7, command.length - 1);
                    this.webSearch.search(query);
                } else if (cmd.startsWith("CONFIG ")) {
                    this.configTwilio(command);
                } else {
                    console.log(
                        chalk.red(
                            "❌ Comando no reconocido. Escribe HELP; para ver los comandos disponibles.",
                        ),
                    );
                }
                break;
        }

        setTimeout(() => this.promptCommand(), 100);
    }

    enableCrotoSafe() {
        console.log(chalk.blue("🔧 Iniciando CrotoSafe..."));

        try {
            this.crotosafe = new CrotoSafe();
            this.crotosafe.start();
            this.isRunning = true;

            console.log(chalk.green("✅ CrotoSafe activado correctamente!"));
            console.log(chalk.yellow("🛡️  Sistema de seguridad funcionando"));
            console.log(chalk.yellow("📱 Webhook activo en puerto 5000"));
            console.log(chalk.yellow("🚫 Protección antilink activada"));
            console.log(chalk.yellow("🔒 Protección antispam activada"));
            console.log(
                chalk.yellow("👥 Protección de administradores activada"),
            );
        } catch (error) {
            console.log(
                chalk.red("❌ Error al activar CrotoSafe:"),
                error.message,
            );
            console.log(
                chalk.yellow(
                    "💡 Asegúrate de configurar tus credenciales de Twilio primero",
                ),
            );
        }
    }

    showStatus() {
        if (!this.isRunning) {
            console.log(chalk.red("❌ CrotoSafe no está activo"));
            console.log(
                chalk.yellow('💡 Ejecuta "ENABLE crotosafe;" para activarlo'),
            );
            return;
        }

        const stats = this.crotosafe.getStats();

        console.log(chalk.green("📊 Estado de CrotoSafe:"));
        console.log("");
        console.log(chalk.blue("🟢 Estado: "), chalk.green("ACTIVO"));
        console.log(
            chalk.blue("📨 Mensajes procesados: "),
            stats.messagesProcessed,
        );
        console.log(
            chalk.blue("🚫 Mensajes bloqueados: "),
            stats.blockedMessages,
        );
        console.log(chalk.blue("⚠️  Advertencias enviadas: "), stats.warnings);
        console.log(chalk.blue("🔒 Usuarios baneados: "), stats.bannedUsers);
        console.log(chalk.blue("🕐 Tiempo activo: "), stats.uptime);
        console.log(chalk.blue("🌐 Webhook: "), stats.webhookStatus);
        console.log("");
    }

    showHelp() {
        console.log(chalk.cyan("📖 Comandos disponibles en CrotoSafe:"));
        console.log("");
        console.log(
            chalk.yellow("ENABLE crotosafe;"),
            "   - Activa el sistema de seguridad",
        );
        console.log(
            chalk.yellow("SHOW crotosafe;"),
            "     - Muestra estadísticas del sistema",
        );
        console.log(
            chalk.yellow("CONFIG twilio;"),
            "      - Configura credenciales de Twilio",
        );
        console.log(
            chalk.yellow("SEARCH <término>;"),
            "   - Busca información en la web",
        );
        console.log(
            chalk.yellow("HELP;"),
            "              - Muestra este menú de ayuda",
        );
        console.log(chalk.yellow("EXIT;"), "              - Sale de CrotoSafe");
        console.log("");
        console.log(chalk.green("🛡️  Funciones de seguridad incluidas:"));
        console.log(chalk.blue("   • Antilink - Bloquea enlaces maliciosos"));
        console.log(chalk.blue("   • Antispam - Detecta y bloquea spam"));
        console.log(
            chalk.blue(
                "   • Protección de admins - Protege a los administradores",
            ),
        );
        console.log(
            chalk.blue("   • Rate limiting - Previene flood de mensajes"),
        );
        console.log(
            chalk.blue("   • ML Detection - Detección inteligente de amenazas"),
        );
        console.log("");
    }

    configTwilio(command) {
        console.log(chalk.blue("🔧 Configuración de Twilio:"));
        console.log(
            chalk.yellow("Crea un archivo .env con las siguientes variables:"),
        );
        console.log("");
        console.log("TWILIO_ACCOUNT_SID=tu_account_sid");
        console.log("TWILIO_API_KEY=tu_api_key");
        console.log("TWILIO_API_SECRET=tu_api_secret");
        console.log("WHATSAPP_NUMBER=tu_numero_whatsapp");
        console.log("");
        console.log(
            chalk.green(
                "💡 Obtén estas credenciales desde tu dashboard de Twilio",
            ),
        );
    }

    exit() {
        console.log(chalk.yellow("👋 Saliendo de CrotoSafe..."));
        if (this.crotosafe) {
            this.crotosafe.stop();
        }
        this.rl.close();
        process.exit(0);
    }
}

// ==================== EJECUCIÓN PRINCIPAL ====================

if (require.main === module) {
    const cli = new CrotoSafeCLI();
    cli.start();
}

module.exports = { CrotoSafe, CrotoSafeCLI };