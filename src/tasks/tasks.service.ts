import { Injectable, Logger } from "@nestjs/common"
import { Cron, Interval, Timeout } from "@nestjs/schedule"
import S3 from "aws-sdk/clients/s3"
import axios from "axios"
import fs from "fs"
import { LessThanOrEqual, MoreThanOrEqual } from "typeorm"
import convert from "xml-js"

import { Athlete } from "../entities/Athlete"
import { AthleteStat } from "../entities/AthleteStat"
import { Game } from "../entities/Game"
import { GameTeam } from "../entities/GameTeam"
import { Team } from "../entities/Team"

import { ATHLETE_MLB_BASE_ANIMATION, ATHLETE_MLB_BASE_IMG, ATHLETE_MLB_IMG } from "../utils/svgTemplates"
import { SportType } from "../utils/types"

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name)

  async testAnimation() {
    const athlete = await Athlete.findOneOrFail({
      where: { id: 1 },
      relations: { team: true },
    })
    const baseImage = ATHLETE_MLB_BASE_IMG
    var options = { compact: true, ignoreComment: true, spaces: 4 }
    var result: any = convert.xml2js(baseImage, options)
    console.log(result["svg"]["g"]["4"]["g"][3]["text"][0]["tspan"]["_cdata"]) // First name
    console.log(result["svg"]["g"]["4"]["g"][3]["g"]["text"][0]["tspan"]["_cdata"]) // First name

    console.log(result["svg"]["g"][4]["g"][3]["text"][1]["tspan"]["_cdata"]) // Last name
    console.log(result["svg"]["g"][4]["g"][3]["g"]["text"][1]["tspan"]["_cdata"]) // Last name

    console.log(result["svg"]["g"][1]["g"][2]["g"]["path"]["_attributes"]["fill"]) // Primary color
    console.log(result["svg"]["g"][1]["g"][0]["g"]["path"]["_attributes"]["fill"]) // Secondary color

    console.log(result["svg"]["g"][4]["g"][2]["g"]["text"]["tspan"]["_cdata"]) // Jersey
    console.log(result["svg"]["g"][4]["g"][0]["g"]["g"]["text"]["tspan"]["_cdata"]) // Position

    result["svg"]["g"]["4"]["g"][3]["text"][0]["tspan"]["_cdata"] = athlete.firstName
    result["svg"]["g"]["4"]["g"][3]["g"]["text"][0]["tspan"]["_cdata"] = athlete.firstName
    result["svg"]["g"][4]["g"][3]["text"][1]["tspan"]["_cdata"] = athlete.lastName
    result["svg"]["g"][4]["g"][3]["g"]["text"][1]["tspan"]["_cdata"] = athlete.lastName
    result["svg"]["g"][1]["g"][2]["g"]["path"]["_attributes"]["fill"] = athlete.team.primaryColor
    result["svg"]["g"][1]["g"][0]["g"]["path"]["_attributes"]["fill"] = athlete.team.secondaryColor
    result["svg"]["g"][4]["g"][2]["g"]["text"]["tspan"]["_cdata"] = athlete.jersey ? athlete.jersey.toString() : "00"
    result["svg"]["g"][4]["g"][0]["g"]["g"]["text"]["tspan"]["_cdata"] = athlete.position

    const animation = convert.js2xml(result, options)
    result = animation.replace("</svg>", ATHLETE_MLB_BASE_ANIMATION)
    // fs.writeFileSync("./testAthleteAnimation.svg", result)
  }

  // @Timeout(1)
  async syncMlbData() {
    const teamsCount = await Team.count({
      where: { sport: SportType.MLB },
    })

    if (teamsCount === 0) {
      const { data, status } = await axios.get(
        `${process.env.SPORTS_DATA_URL}mlb/scores/json/teams?key=${process.env.SPORTS_DATA_MLB_KEY}`
      )

      if (status === 200) {
        for (let team of data) {
          try {
            await Team.create({
              apiId: team["GlobalTeamID"],
              name: team["Name"],
              key: team["Key"],
              location: team["City"],
              sport: SportType.MLB,
              primaryColor: `#${team["PrimaryColor"]}`,
              secondaryColor: `#${team["SecondaryColor"]}`,
            }).save()
          } catch (e) {
            this.logger.error(e)
          }
        }
      } else {
        this.logger.error("MLB Teams Data: SPORTS DATA ERROR")
      }
    }

    this.logger.debug(`MLB Teams Data: ${teamsCount ? "DID NOT SYNC" : "SYNCED SUCCESSFULLY"}`)

    const athletesCount = await Athlete.count({
      where: { team: { sport: SportType.MLB } },
    })

    if (athletesCount === 0) {
      const { data, status } = await axios.get(
        `${process.env.SPORTS_DATA_URL}mlb/scores/json/Players?key=${process.env.SPORTS_DATA_MLB_KEY}`
      )

      if (status === 200) {
        for (let athlete of data) {
          try {
            const team = await Team.findOneOrFail({
              where: { apiId: athlete["GlobalTeamID"] },
            })

            var options = { compact: true, ignoreComment: true, spaces: 4 }
            var result: any = convert.xml2js(ATHLETE_MLB_IMG, options)

            result.svg.path[10]["_attributes"]["fill"] = team.primaryColor
            result.svg.path[9]["_attributes"]["fill"] = team.secondaryColor
            result.svg.g[0].text[0]["_text"] = athlete["FirstName"].toUpperCase()
            result.svg.g[0].text[1]["_text"] = athlete["LastName"].toUpperCase()
            result.svg.g[0].text[2]["_text"] = athlete["Position"].toUpperCase()
            result.svg.text["_text"] = athlete["Jersey"] ? athlete["Jersey"] : "00"

            result = convert.js2xml(result, options)
            var buffer = Buffer.from(result, "utf8")
            const s3 = new S3({
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            })
            const filename = `${athlete["PlayerID"]}.svg`
            const s3_location = "media/athlete/mlb/"
            const fileContent = buffer
            const params: any = {
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: `${s3_location}${filename}`,
              Body: fileContent,
              ContentType: "image/svg+xml",
              CacheControl: "no-cache",
            }

            s3.upload(params, async (err: any, data: any) => {
              if (err) {
                this.logger.error(err)
              } else {
                const nftImage = data["Location"]

                const baseImage = ATHLETE_MLB_BASE_IMG
                var options = { compact: true, ignoreComment: true, spaces: 4 }
                var result: any = convert.xml2js(baseImage, options)

                result["svg"]["g"]["4"]["g"][3]["text"][0]["tspan"]["_cdata"] = athlete["FirstName"].toUpperCase()
                result["svg"]["g"]["4"]["g"][3]["g"]["text"][0]["tspan"]["_cdata"] = athlete["FirstName"].toUpperCase()
                result["svg"]["g"][4]["g"][3]["text"][1]["tspan"]["_cdata"] = athlete["LastName"].toUpperCase()
                result["svg"]["g"][4]["g"][3]["g"]["text"][1]["tspan"]["_cdata"] = athlete["LastName"].toUpperCase()
                result["svg"]["g"][1]["g"][2]["g"]["path"]["_attributes"]["fill"] = team.primaryColor
                result["svg"]["g"][1]["g"][0]["g"]["path"]["_attributes"]["fill"] = team.secondaryColor
                result["svg"]["g"][4]["g"][2]["g"]["text"]["tspan"]["_cdata"] = athlete["Jersey"]
                  ? athlete["Jersey"].toString()
                  : "00"
                result["svg"]["g"][4]["g"][0]["g"]["g"]["text"]["tspan"]["_cdata"] = athlete["Position"].toUpperCase()

                const animation = convert.js2xml(result, options)
                result = animation.replace("</svg>", ATHLETE_MLB_BASE_ANIMATION)
                var buffer = Buffer.from(result, "utf8")
                const s3 = new S3({
                  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                })
                const filename = `${athlete["PlayerID"]}.svg`
                const s3_location = "media/athlete_animations/mlb/"
                const fileContent = buffer
                const params: any = {
                  Bucket: process.env.AWS_BUCKET_NAME,
                  Key: `${s3_location}${filename}`,
                  Body: fileContent,
                  ContentType: "image/svg+xml",
                  CacheControl: "no-cache",
                }

                s3.upload(params, async (err: any, data: any) => {
                  if (err) {
                    this.logger.error(err)
                  } else {
                    await Athlete.create({
                      apiId: athlete["PlayerID"],
                      firstName: athlete["FirstName"],
                      lastName: athlete["LastName"],
                      position: athlete["Position"],
                      salary: athlete["Salary"],
                      jersey: athlete["Jersey"],
                      team,
                      isActive: athlete["Status"] === "Active",
                      isInjured: athlete["InjuryStatus"] !== null,
                      nftImage,
                      nftAnimation: data["Location"],
                    }).save()
                  }
                })
              }
            })
          } catch (e) {
            this.logger.error(e)
          }
        }
      } else {
        this.logger.error("MLB Athletes Data: SPORTS DATA ERROR")
      }
    }

    this.logger.debug(`MLB Athletes Data: ${athletesCount ? "DID NOT SYNC" : "SYNCED SUCCESSFULLY"}`)
  }

  @Timeout(1)
  async syncNflData() {
    const teamsCount = await Team.count({
      where: { sport: SportType.NFL },
    })

    if (teamsCount === 0) {
      const { data, status } = await axios.get(
        `${process.env.SPORTS_DATA_URL}nfl/scores/json/Teams?key=${process.env.SPORTS_DATA_NFL_KEY}`
      )

      if (status === 200) {
        for (let team of data) {
          try {
            await Team.create({
              apiId: team["GlobalTeamID"],
              name: team["Name"],
              key: team["Key"],
              location: team["City"],
              sport: SportType.NFL,
              primaryColor: `#${team["PrimaryColor"]}`,
              secondaryColor: `#${team["SecondaryColor"]}`,
            }).save()
          } catch (e) {
            this.logger.error(e)
          }
        }
      } else {
        this.logger.error("NFL Teams Data: SPORTS DATA ERROR")
      }
    }

    this.logger.debug(`NFL Teams Data: ${teamsCount ? "DID NOT SYNC" : "SYNCED SUCCESSFULLY"}`)

    const athletesCount = await Athlete.count({
      where: { team: { sport: SportType.NFL } },
    })

    if (athletesCount === 0) {
      const { data, status } = await axios.get(
        `${process.env.SPORTS_DATA_URL}nfl/scores/json/Players?key=${process.env.SPORTS_DATA_NFL_KEY}`
      )

      if (status === 200) {
        for (let athlete of data) {
          try {
            const team = await Team.findOne({
              where: { apiId: athlete["GlobalTeamID"] },
            })

            if (team) {
              var svgTemplate = fs.readFileSync(`./src/utils/nfl-svg-teams-templates/${team.key}.svg`, "utf-8")
              var options = { compact: true, ignoreComment: true, spaces: 4 }
              var result: any = convert.xml2js(svgTemplate, options)

              try {
                result.svg.g[5].text[2]["_text"] = athlete["FirstName"].toUpperCase()
                result.svg.g[5].text[3]["_text"] = athlete["LastName"].toUpperCase()
                result.svg.g[5].text[1]["_text"] = athlete["Position"].toUpperCase()
                result.svg.g[5].text[0]["_text"] = ""
              } catch (e) {
                console.log(`FAILED AT ATHLETE ID: ${athlete["PlayerID"]} and TEAM KEY: ${team.key}`)
              }

              result = convert.js2xml(result, options)
              // fs.writeFileSync(
              //   `./nfl-images/${athlete["PlayerID"]}-${athlete["FirstName"].toLowerCase()}-${athlete[
              //     "LastName"
              //   ].toLowerCase()}.svg`,
              //   result
              // )
              var buffer = Buffer.from(result, "utf8")
              const s3 = new S3({
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              })
              const filename = `${athlete["PlayerID"]}-${athlete["FirstName"].toLowerCase()}-${athlete[
                "LastName"
              ].toLowerCase()}.svg`
              const s3_location = "media/athlete/nfl/images/"
              const fileContent = buffer
              const params: any = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `${s3_location}${filename}`,
                Body: fileContent,
                ContentType: "image/svg+xml",
                CacheControl: "no-cache",
              }

              s3.upload(params, async (err: any, data: any) => {
                if (err) {
                  this.logger.error(err)
                } else {
                  const nftImage = data["Location"]

                  var svgAnimationTemplate = fs.readFileSync(
                    `./src/utils/nfl-svg-teams-animation-templates/${team.key}.svg`,
                    "utf-8"
                  )
                  var options = { compact: true, ignoreComment: true, spaces: 4 }
                  var result: any = convert.xml2js(svgAnimationTemplate, options)

                  try {
                    result.svg.g[5].text[0].tspan["_cdata"] = ""
                    result.svg.g[5].text[1].tspan["_cdata"] = ""
                    result.svg.g[5].text[2].tspan["_cdata"] = athlete["FirstName"].toUpperCase()
                    result.svg.g[5].text[3].tspan["_cdata"] = athlete["FirstName"].toUpperCase()
                    result.svg.g[5].text[4].tspan["_cdata"] = athlete["LastName"].toUpperCase()
                    result.svg.g[5].text[5].tspan["_cdata"] = athlete["LastName"].toUpperCase()
                    result.svg.g[5].g[0].text[0].tspan["_cdata"] = athlete["Position"].toUpperCase()
                    result.svg.g[5].g[0].text[1].tspan["_cdata"] = athlete["Position"].toUpperCase()
                    result = convert.js2xml(result, options)
                  } catch (e) {
                    console.log(`FAILED AT ATHLETE ID: ${athlete["PlayerID"]} and TEAM KEY: ${team.key}`)
                    console.log(e)
                  }

                  // fs.writeFileSync(
                  //   `./nfl-animations/${athlete["PlayerID"]}-${athlete["FirstName"].toLowerCase()}-${athlete[
                  //     "LastName"
                  //   ].toLowerCase()}.svg`,
                  //   result
                  // )
                  var buffer = Buffer.from(result, "utf8")
                  const s3 = new S3({
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                  })
                  const filename = `${athlete["PlayerID"]}-${athlete["FirstName"].toLowerCase()}-${athlete[
                    "LastName"
                  ].toLowerCase()}.svg`
                  const s3_location = "media/athlete/nfl/animations/"
                  const fileContent = buffer
                  const params: any = {
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: `${s3_location}${filename}`,
                    Body: fileContent,
                    ContentType: "image/svg+xml",
                    CacheControl: "no-cache",
                  }

                  s3.upload(params, async (err: any, data: any) => {
                    if (err) {
                      this.logger.error(err)
                    } else {
                      await Athlete.create({
                        apiId: athlete["PlayerID"],
                        firstName: athlete["FirstName"],
                        lastName: athlete["LastName"],
                        position: athlete["Position"],
                        jersey: athlete["Number"],
                        team,
                        isActive: athlete["Status"] === "Active",
                        isInjured: athlete["InjuryStatus"] !== null,
                        nftImage,
                        nftAnimation: data["Location"],
                      }).save()
                    }
                  })
                }
              })
            }
          } catch (e) {
            this.logger.error(e)
          }
        }
      } else {
        this.logger.error("NFL Athletes Data: SPORTS DATA ERROR")
      }
    }

    this.logger.debug(`NFL Athletes Data: ${athletesCount ? "DID NOT SYNC" : "SYNCED SUCCESSFULLY"}`)
  }

  // @Timeout(1)
  async generateAthleteNflAssets() {
    this.logger.debug("Generate Athlete NFL Assets: STARTED")

    const athletes = await Athlete.find({
      where: { team: { sport: SportType.NFL } },
      relations: {
        team: true,
      },
    })

    for (let athlete of athletes) {
      var svgTemplate = fs.readFileSync(`./src/utils/nfl-svg-teams-templates/${athlete.team.key}.svg`, "utf-8")
      var options = { compact: true, ignoreComment: true, spaces: 4 }
      var result: any = convert.xml2js(svgTemplate, options)

      try {
        result.svg.g[5].text[2]["_text"] = athlete.firstName.toUpperCase()
        result.svg.g[5].text[3]["_text"] = athlete.lastName.toUpperCase()
        result.svg.g[5].text[1]["_text"] = athlete.position.toUpperCase()
        result.svg.g[5].text[0]["_text"] = ""
      } catch (e) {
        console.log(`FAILED AT ATHLETE ID: ${athlete.apiId} and TEAM KEY: ${athlete.team.key}`)
      }

      result = convert.js2xml(result, options)
      // fs.writeFileSync(
      //   `./nfl-images/${athlete["PlayerID"]}-${athlete["FirstName"].toLowerCase()}-${athlete[
      //     "LastName"
      //   ].toLowerCase()}.svg`,
      //   result
      // )

      var buffer = Buffer.from(result, "utf8")
      const s3 = new S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      })
      const filename = `${athlete.apiId}-${athlete.firstName.toLowerCase()}-${athlete.lastName.toLowerCase()}.svg`
      const s3_location = "media/athlete/nfl/images/"
      const fileContent = buffer
      const params: any = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `${s3_location}${filename}`,
        Body: fileContent,
        ContentType: "image/svg+xml",
        CacheControl: "no-cache",
      }

      s3.upload(params, async (err: any, data: any) => {
        if (err) {
          this.logger.error(err)
        } else {
          const nftImage = data["Location"]
          athlete.nftImage = nftImage

          var svgAnimationTemplate = fs.readFileSync(
            `./src/utils/nfl-svg-teams-animation-templates/${athlete.team.key}.svg`,
            "utf-8"
          )
          var options = { compact: true, ignoreComment: true, spaces: 4 }
          var result: any = convert.xml2js(svgAnimationTemplate, options)

          try {
            result.svg.g[5].text[0].tspan["_cdata"] = ""
            result.svg.g[5].text[1].tspan["_cdata"] = ""
            result.svg.g[5].text[2].tspan["_cdata"] = athlete.firstName.toUpperCase()
            result.svg.g[5].text[3].tspan["_cdata"] = athlete.firstName.toUpperCase()
            result.svg.g[5].text[4].tspan["_cdata"] = athlete.lastName.toUpperCase()
            result.svg.g[5].text[5].tspan["_cdata"] = athlete.lastName.toUpperCase()
            result.svg.g[5].g[0].text[0].tspan["_cdata"] = athlete.position.toUpperCase()
            result.svg.g[5].g[0].text[1].tspan["_cdata"] = athlete.position.toUpperCase()
            result = convert.js2xml(result, options)
          } catch (e) {
            console.log(`FAILED AT ATHLETE ID: ${athlete.apiId} and TEAM KEY: ${athlete.team.key}`)
            console.log(e)
          }

          // fs.writeFileSync(
          //   `./nfl-animations/${athlete["PlayerID"]}-${athlete["FirstName"].toLowerCase()}-${athlete[
          //     "LastName"
          //   ].toLowerCase()}.svg`,
          //   result
          // )
          var buffer = Buffer.from(result, "utf8")
          const s3 = new S3({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          })
          const filename = `${athlete.apiId}-${athlete.firstName.toLowerCase()}-${athlete.lastName.toLowerCase()}.svg`
          const s3_location = "media/athlete/nfl/animations/"
          const fileContent = buffer
          const params: any = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${s3_location}${filename}`,
            Body: fileContent,
            ContentType: "image/svg+xml",
            CacheControl: "no-cache",
          }

          s3.upload(params, async (err: any, data: any) => {
            if (err) {
              this.logger.error(err)
            } else {
              athlete.nftAnimation = data["Location"]
              await Athlete.save(athlete)
            }
          })
        }
      })
    }

    this.logger.debug("Generate Athlete NFL Assets: FINISHED")
    this.logger.debug(`TOTAL ATHLETES: ${athletes.length}`)
  }

  @Interval(900000) // Runs every 15 mins
  async updateNflAthleteStats() {
    this.logger.debug("Update NFL Athlete Stats: STARTED")

    const timeFrames = await axios.get(
      `${process.env.SPORTS_DATA_URL}nfl/scores/json/Timeframes/current?key=${process.env.SPORTS_DATA_NFL_KEY}`
    )

    if (timeFrames.status === 200) {
      const timeFrame = timeFrames.data[0]

      if (timeFrame) {
        // const season = new Date().getFullYear() - 1
        const season = timeFrame.ApiSeason

        const { data, status } = await axios.get(
          `${process.env.SPORTS_DATA_URL}nfl/stats/json/PlayerSeasonStats/${season}?key=${process.env.SPORTS_DATA_NFL_KEY}`
        )

        if (status === 200) {
          const newStats: AthleteStat[] = []
          const updateStats: AthleteStat[] = []

          for (let athleteStat of data) {
            const apiId: any = athleteStat["PlayerID"]
            const curStat = await AthleteStat.findOne({
              where: { athlete: { apiId }, season: season.toString() },
              relations: {
                athlete: true,
              },
            })

            if (curStat) {
              // Update stats here
              curStat.fantasyScore = athleteStat["FantasyPointsDraftKings"]
              curStat.completion = athleteStat["PassingCompletionPercentage"]
              curStat.carries = athleteStat["RushingAttempts"]
              curStat.passingYards = athleteStat["PassingYards"]
              curStat.rushingYards = athleteStat["RushingYards"]
              curStat.receivingYards = athleteStat["ReceivingYards"]
              curStat.interceptions = athleteStat["PassingInterceptions"]
              curStat.passingTouchdowns = athleteStat["PassingTouchdowns"]
              curStat.rushingTouchdowns = athleteStat["RushingTouchdowns"]
              curStat.receivingTouchdowns = athleteStat["ReceivingTouchdowns"]
              curStat.targets = athleteStat["ReceivingTargets"]
              curStat.receptions = athleteStat["Receptions"]
              updateStats.push(curStat)
            } else {
              const curAthlete = await Athlete.findOne({
                where: { apiId },
              })

              if (curAthlete) {
                newStats.push(
                  AthleteStat.create({
                    athlete: curAthlete,
                    season: season.toString(),
                    position: athleteStat["Position"],
                    fantasyScore: athleteStat["FantasyPointsDraftKings"],
                    completion: athleteStat["PassingCompletionPercentage"],
                    carries: athleteStat["RushingAttempts"],
                    passingYards: athleteStat["PassingYards"],
                    rushingYards: athleteStat["RushingYards"],
                    receivingYards: athleteStat["ReceivingYards"],
                    passingTouchdowns: athleteStat["PassingTouchdowns"],
                    interceptions: athleteStat["PassingInterceptions"],
                    rushingTouchdowns: athleteStat["RushingTouchdowns"],
                    receivingTouchdowns: athleteStat["ReceivingTouchdowns"],
                    targets: athleteStat["ReceivingTargets"],
                    receptions: athleteStat["Receptions"],
                  })
                )
              }
            }
          }

          await AthleteStat.save([...newStats, ...updateStats], { chunk: 20 })

          this.logger.debug("Update NFL Athlete Stats: FINISHED")
        } else {
          this.logger.error("NFL Athlete Stats Data: SPORTS DATA ERROR")
        }
      }
    } else {
      this.logger.error("NFL Timeframes Data: SPORTS DATA ERROR")
    }
  }

  @Cron("55 11 * * *", {
    name: "updateNflTeamScores",
    timeZone: "Asia/Manila",
  })
  async updateNflTeamScores() {
    this.logger.debug("Update NFL Team Scores: STARTED")

    const timeFrames = await axios.get(
      `https://api.sportsdata.io/v3/nfl/scores/json/Timeframes/current?key=${process.env.SPORTS_DATA_NFL_KEY}`
    )

    if (timeFrames.status === 200) {
      const timeFrame = timeFrames.data[0]

      if (timeFrame) {
        const season = timeFrame.ApiSeason
        // const season = "2021REG"
        const week = timeFrame.ApiWeek ? timeFrame.ApiWeek : 1

        const { data, status } = await axios.get(
          `${process.env.SPORTS_DATA_URL}nfl/stats/json/PlayerGameStatsByWeek/${season}/${week}?key=${process.env.SPORTS_DATA_NFL_KEY}`
        )

        if (status === 200) {
          const now = new Date()
          const gameTeams = []

          // Get active games
          const games = await Game.find({
            where: {
              startTime: LessThanOrEqual(now),
              endTime: MoreThanOrEqual(now),
            },
            relations: {
              teams: {
                athletes: {
                  athlete: true,
                },
              },
            },
          })

          for (let game of games) {
            for (let gameTeam of game.teams) {
              var totalFantasyScore = 0

              for (let athlete of gameTeam.athletes) {
                const athleteData = data.find((athleteData: any) => athleteData.PlayerID === athlete.athlete.apiId)

                if (athleteData !== undefined) {
                  totalFantasyScore += athleteData.FantasyPointsDraftKings
                }
              }

              gameTeam.fantasyScore = totalFantasyScore
              gameTeams.push(gameTeam)
            }
          }

          await GameTeam.save(gameTeams, { chunk: 20 })

          this.logger.debug("Update NFL Team Scores: FINISHED")
        }
      }
    }
  }
}
